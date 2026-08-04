import { CNSProgressSerializer } from '@cnstra/persist';
import type {
    CNSPersistOptionsRegistry,
    ICNSProgressRepository,
    ICNSProgressRecordingStrategy,
    ICNSStimulationRepository,
} from '@cnstra/persist';
import type { ICNS } from '@cnstra/types';
import { runStimulationJob, createDrainState } from '@cnstra/broker';
import type {
    IPgBossLike,
    IPgBossJob,
    TCNSStimulationJobData,
} from './types';

export interface TCNSWorkerOptions {
    /** Your pg-boss instance (already started). */
    boss: IPgBossLike;
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
     * each pg-boss retry = a new attempt.
     */
    observe?: ICNSStimulationRepository;
    /**
     * Optional resumable **resume**. When set, the worker records the run's
     * outstanding frontier (by name) into `repository` as it advances, and a
     * retried job (same job id) resumes from that frontier via `cns.activate(...)`
     * instead of re-running from the entry signal. The record's lifecycle matches
     * the pg-boss job row: dropped on success, kept on failure for the retry.
     *
     * Requires every neuron/collateral that can appear in the frontier to be in
     * the `registry` (not just the entry collaterals). Neurons should still be
     * idempotent — resume narrows re-execution to the unfinished branch, it does
     * not make individual hops exactly-once.
     */
    resume?: {
        repository: ICNSProgressRepository;
        /** When to persist during the run. Defaults to debounce + max-staleness. */
        strategy?: ICNSProgressRecordingStrategy;
    };
    /** pg-boss `work` options (batchSize, pollingIntervalSeconds, …). */
    workOptions?: Record<string, unknown>;
}

/**
 * Register a pg-boss worker that turns each job into a CNStra stimulation.
 *
 * One job = one stimulation. The job carries `{ collateralName, payload }`; the
 * worker reconstructs the entry signal by name, stimulates, optionally streams
 * per-hop progress, and awaits completion. If the stimulation fails or aborts,
 * `waitUntilComplete()` rejects and the error propagates so pg-boss applies its
 * own retry/backoff policy.
 */
/** A registered worker + a graceful `shutdown` (see {@link createCNSWorker}). */
export interface TCNSPgBossWorkerHandle {
    /** The pg-boss `work()` registration id. */
    workId: string;
    /**
     * Graceful shutdown of THIS worker's processing: stop taking new jobs, let
     * in-flight stimulations finish for up to `drainMs` (default 10s), then **abort**
     * whatever is still running — an aborted stimulation's remaining tasks become its
     * frontier, which the resume checkpoint records, so the job's retry resumes there.
     * It does NOT stop or close your `boss` (you own it) or your stores — call
     * `boss.stop(...)` and close your stores after this resolves.
     */
    shutdown(opts?: { drainMs?: number }): Promise<void>;
}

export async function createCNSWorker(
    options: TCNSWorkerOptions
): Promise<TCNSPgBossWorkerHandle> {
    const { boss, cns, registry, queue, observe, resume, workOptions } =
        options;

    // One serializer per worker; the per-job pipeline lives in @cnstra/broker.
    const serializer = resume ? new CNSProgressSerializer(registry) : undefined;
    const drain = createDrainState();

    const runJob = async (
        job: IPgBossJob<TCNSStimulationJobData>
    ): Promise<void> => {
        await runStimulationJob({
            pkgName: '@cnstra/pg-boss',
            stopping: drain.isStopping(),
            cns,
            registry,
            jobId: job.id,
            collateralName: job.data.collateralName,
            payload: job.data.payload,
            maxNeuronHops: job.data.maxNeuronHops,
            // Each pg-boss retry is a new attempt (retryCount is 0-based).
            attemptNumber: (job.retryCount ?? 0) + 1,
            observe,
            serializer,
            resumeRepo: resume?.repository,
            resumeStrategy: resume?.strategy,
            abort: drain.abort,
            active: drain.active,
        });
    };

    const handler = async (
        jobs: IPgBossJob<TCNSStimulationJobData>[]
    ): Promise<void> => {
        for (const job of jobs) {
            await runJob(job);
        }
    };

    const workId = await (workOptions
        ? boss.work<TCNSStimulationJobData>(queue, workOptions, handler)
        : boss.work<TCNSStimulationJobData>(queue, handler));

    const shutdown = async (opts?: { drainMs?: number }): Promise<void> => {
        await drain.drainAndAbort(opts?.drainMs ?? 10_000);
    };

    return { workId, shutdown };
}
