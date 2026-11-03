import { CNSProgressSerializer } from '@cnstra/persist';
import type {
    CNSPersistOptionsRegistry,
    ICNSProgressRepository,
    ICNSProgressRecordingStrategy,
    ICNSStimulationWriter,
    TCNSProgress,
} from '@cnstra/persist';
import type { ICNS } from '@cnstra/types';
import { runCNSStimulationJob, createCNSDrainState } from '@cnstra/broker';
import type {
    ICNSBullJob,
    ICNSBullWorkerCtor,
    ICNSBullWorkerLike,
    TCNSStimulationJobData,
} from './types';

export type TCNSWorkerOptions<TWorkerClass extends ICNSBullWorkerCtor<never>> = {
    /** The BullMQ `Worker` class (pass `Worker` from 'bullmq'). */
    Worker: TWorkerClass;
    /** The CNS the jobs run against. */
    cns: ICNS<any, any>;
    /** Name ↔ object registry used to reconstruct signals from job data. */
    registry: CNSPersistOptionsRegistry;
    /** Queue name to consume. */
    queue: string;
    /**
     * Optional **observability** store: the canonical name-based
     * Stimulation → Attempt → Task history (the SAME model the devtools use),
     * written per hop via a {@link CNSStimulationPersistor}. Pass a
     * `CNSInMemoryStimulationRepository` to just *see* progress (ephemeral), or a
     * Postgres store to keep it. It records history; it does not drive resume —
     * that is `resume` below. One job = one stimulation (`stimulationId` = job id),
     * each BullMQ retry = a new attempt.
     */
    observe?: ICNSStimulationWriter;
    /**
     * Optional resumable **resume**. When set, the worker records the run's
     * outstanding frontier (by name) as it advances, and a retried job (BullMQ
     * reuses the SAME job id) resumes from that frontier via `cns.activate(...)`
     * instead of re-running from the entry signal. Dropped on success, kept on
     * failure for the retry.
     *
     * **`repository` is OPTIONAL.** Omit it and the checkpoint lives in BullMQ's
     * own per-job progress (`job.updateProgress` / `job.progress`, in Redis) — no
     * separate store, the natural place for a Bull job. Provide a `repository`
     * only to store it elsewhere (e.g. a shared Postgres table).
     *
     * Requires every neuron/collateral that can appear in the frontier to be in
     * the `registry` (not just the entry collaterals). Neurons should still be
     * idempotent — resume narrows re-execution to the unfinished branch, it does
     * not make individual hops exactly-once.
     */
    resume?: {
        repository?: ICNSProgressRepository;
        /** When to persist during the run. Defaults to debounce + max-staleness. */
        strategy?: ICNSProgressRecordingStrategy;
    };
    /** The `Worker` class's own options, typed by it: `connection`, `concurrency`, `limiter`, … */
    workerOptions: NonNullable<ConstructorParameters<TWorkerClass>[2]>;
};

/**
 * Construct a BullMQ worker that turns each job into a CNStra stimulation.
 *
 * One job = one stimulation. The job carries `{ collateralName, payload }`; the
 * worker reconstructs the entry signal by name, stimulates, optionally streams
 * per-hop progress, and awaits completion. If the stimulation fails, the
 * processor rejects and the error propagates so BullMQ applies its own
 * retry/backoff policy — and, with `resume`, the retry continues the frontier.
 *
 * Returns the constructed `Worker` (call `.close()` to shut it down).
 */
/**
 * A per-job progress store backed by BullMQ's OWN job progress (Redis) — the
 * default when no external `resume.repository` is given. `save` writes the frontier
 * via `job.updateProgress`; `load` reads it back from `job.progress` on a retry;
 * `delete` is a no-op (the progress is discarded together with the job).
 */
function jobProgressRepository(
    job: ICNSBullJob<TCNSStimulationJobData>
): ICNSProgressRepository {
    return {
        save: async (_key: string, progress: TCNSProgress) => {
            await job.updateProgress?.(progress);
        },
        load: async () => {
            const p = job.progress;
            return p &&
                typeof p === 'object' &&
                'tasks' in (p as Record<string, unknown>)
                ? (p as TCNSProgress)
                : undefined;
        },
        delete: async () => {
            /* progress is dropped together with the job on completion */
        },
    };
}

/** A running worker + a graceful `shutdown` (see {@link createCNSWorker}). */
export type TCNSBullWorkerHandle<TWorker extends ICNSBullWorkerLike = ICNSBullWorkerLike> = {
    /** The constructed BullMQ worker (for power users / event listeners). */
    worker: TWorker;
    /**
     * Graceful shutdown: stop taking new jobs, let in-flight stimulations finish for
     * up to `drainMs` (default 10s), then **abort** whatever is still running — an
     * aborted stimulation's remaining tasks become its frontier, which the resume
     * checkpoint records, so the job's retry resumes exactly there. Finally closes the
     * worker. Does NOT close your `observe`/`resume` stores (you own those — close them
     * after this resolves).
     */
    shutdown(opts?: { drainMs?: number }): Promise<void>;
};

export function createCNSWorker<TWorkerClass extends ICNSBullWorkerCtor<never>>(
    options: TCNSWorkerOptions<TWorkerClass>
): TCNSBullWorkerHandle<InstanceType<TWorkerClass>> {
    const { Worker, cns, registry, queue, observe, resume, workerOptions } =
        options;

    // One serializer per worker; the per-job pipeline lives in @cnstra/broker.
    const serializer = resume ? new CNSProgressSerializer(registry) : undefined;
    const drain = createCNSDrainState();

    const runJob = async (
        job: ICNSBullJob<TCNSStimulationJobData>
    ): Promise<void> => {
        // Resume store: an external repository if given, else BullMQ's own per-job
        // progress (job.updateProgress / job.progress) — no separate store.
        const resumeRepo: ICNSProgressRepository | undefined = resume
            ? resume.repository ?? jobProgressRepository(job)
            : undefined;
        await runCNSStimulationJob({
            pkgName: '@cnstra/bullmq',
            stopping: drain.isStopping(),
            cns,
            registry,
            jobId: String(job.id ?? job.name),
            collateralName: job.data.collateralName,
            payload: job.data.payload,
            maxNeuronHops: job.data.maxNeuronHops,
            modalityName: job.data.modalityName,
            afferentPathName: job.data.afferentPathName,
            // Each BullMQ retry is a new attempt (attemptsMade is 0-based).
            attemptNumber: (job.attemptsMade ?? 0) + 1,
            observe,
            serializer,
            resumeRepo,
            resumeStrategy: resume?.strategy,
            abort: drain.abort,
            active: drain.active,
        });
    };

    const WorkerOfTheseOptions = Worker as unknown as ICNSBullWorkerCtor<typeof workerOptions>;
    const worker = new WorkerOfTheseOptions<TCNSStimulationJobData>(queue, runJob, workerOptions) as InstanceType<TWorkerClass>;

    const shutdown = async (opts?: { drainMs?: number }): Promise<void> => {
        await drain.drainAndAbort(opts?.drainMs ?? 10_000);
        await worker.close();
    };

    return { worker, shutdown };
}
