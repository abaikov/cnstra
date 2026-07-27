import {
    CNSProgressRecorder,
    CNSProgressSerializer,
    CNSStimulationPersistor,
} from '@cnstra/persist';
import type {
    CNSPersistOptionsRegistry,
    ICNSProgressRepository,
    ICNSProgressRecordingStrategy,
    ICNSStimulationRepository,
    TCNSProgress,
} from '@cnstra/persist';
import type { ICNS, TCNSStimulationResponse } from '@cnstra/types';
import type {
    IBullJob,
    IBullWorkerCtor,
    IBullWorkerLike,
    ICNSResponseLike,
    TCNSStimulationJobData,
} from './types';

export interface TCNSWorkerOptions {
    /** The BullMQ `Worker` class (pass `Worker` from 'bullmq'). */
    Worker: IBullWorkerCtor;
    /** The CNS the jobs run against. */
    cns: ICNS<any, any>;
    /** Name ↔ object registry used to reconstruct signals from job data. */
    registry: CNSPersistOptionsRegistry;
    /** Queue name to consume. */
    queue: string;
    /** BullMQ connection (ioredis instance or `{ host, port }`); passed through. */
    connection?: unknown;
    /**
     * Optional **observability** store: the canonical name-based
     * Stimulation → Attempt → Task history (the SAME model the devtools use),
     * written per hop via a {@link CNSStimulationPersistor}. Pass a
     * `CNSInMemoryStimulationRepository` to just *see* progress (ephemeral), or a
     * Postgres store to keep it. It records history; it does not drive resume —
     * that is `resume` below. One job = one stimulation (`stimulationId` = job id),
     * each BullMQ retry = a new attempt.
     */
    observe?: ICNSStimulationRepository;
    /**
     * Optional durable **resume**. When set, the worker records the run's
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
    /** Extra BullMQ `Worker` options (concurrency, limiter, …); merged with `connection`. */
    workerOptions?: Record<string, unknown>;
}

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
    job: IBullJob<TCNSStimulationJobData>
): ICNSProgressRepository {
    return {
        save: async (_key: string, progress: TCNSProgress) => {
            await job.updateProgress?.(progress as unknown as object);
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

export function createCNSWorker(options: TCNSWorkerOptions): IBullWorkerLike {
    const {
        Worker,
        cns,
        registry,
        queue,
        connection,
        observe,
        resume,
        workerOptions,
    } = options;

    // One serializer per worker; the recorder is per-job (holds job-specific key).
    const serializer = resume
        ? new CNSProgressSerializer(registry)
        : undefined;

    const runJob = async (
        job: IBullJob<TCNSStimulationJobData>
    ): Promise<void> => {
        const jobId = String(job.id ?? job.name);
        const { collateralName, payload, maxNeuronHops } = job.data;
        const collateral = registry.getCollateral(collateralName);
        if (!collateral) {
            throw new Error(
                `[@cnstra/bullmq] Unknown collateral "${collateralName}". ` +
                    `Register it in the CNSPersistOptionsRegistry.`
            );
        }

        // Resume store: an external repository if given, else BullMQ's own per-job
        // progress (job.updateProgress / job.progress) — no separate store.
        const resumeRepo: ICNSProgressRepository | undefined = resume
            ? resume.repository ?? jobProgressRepository(job)
            : undefined;

        // Records the outstanding frontier as the run advances (crash-safety); the
        // explicit save on failure below guarantees the exact final frontier.
        const recorder =
            resume && serializer && resumeRepo
                ? new CNSProgressRecorder({
                      serializer,
                      repository: resumeRepo,
                      key: jobId,
                      strategy: resume.strategy,
                  })
                : undefined;

        // Observability: stream the canonical name-based Stimulation → Attempt →
        // Task model to `observe`. One job = one stimulation; each BullMQ retry is
        // a new attempt (attemptsMade is 0-based).
        const attemptNumber = (job.attemptsMade ?? 0) + 1;
        const persistor = observe
            ? new CNSStimulationPersistor({
                  repository: observe,
                  registry,
                  stimulationId: jobId,
                  stimulationAttemptId: `${jobId}#${attemptNumber}`,
                  attemptNumber,
                  entry: [{ collateralName, payload }],
                  volume: 'full',
              })
            : undefined;

        const onResponse = (resp: ICNSResponseLike) => {
            const r = resp as unknown as TCNSStimulationResponse;
            // recorder → resume checkpoint; persistor → observability history.
            recorder?.onResponse(r);
            persistor?.onResponse(r);
        };

        // Resume from a persisted frontier if this job already has one (a retry of
        // the same job id); otherwise start fresh from the entry signal.
        // Correlate logs to this run: every handler reads `ctx.stimulationContext`
        // (same object on every hop, sync or async) — no wiring on the user's side.
        const stimulationContext = { stimulationId: jobId, attemptNumber };

        let stimulation;
        if (resume && serializer && resumeRepo) {
            const saved = await resumeRepo.load(jobId);
            if (saved) {
                const { tasks, ctx } = serializer.hydrate(saved);
                stimulation = cns.activate(tasks, {
                    maxNeuronHops,
                    ctx,
                    onResponse,
                    stimulationContext,
                });
            }
        }
        if (!stimulation) {
            stimulation = cns.stimulate(collateral.createSignal(payload), {
                maxNeuronHops,
                onResponse,
                stimulationContext,
            });
        }

        try {
            await stimulation.waitUntilComplete();
            // Job about to complete → its resume checkpoint can go (lifecycle = job row).
            if (resumeRepo) await resumeRepo.delete(jobId);
        } catch (err) {
            // Persist the exact final frontier before throwing so the retried job
            // resumes from it (the recorder's cadence may still be debouncing).
            if (resume && serializer && resumeRepo) {
                await resumeRepo.save(jobId, serializer.serialize(stimulation));
            }
            // Let BullMQ decide about retries/backoff.
            throw err;
        } finally {
            recorder?.dispose();
            persistor?.dispose();
        }
    };

    return new Worker<TCNSStimulationJobData>(queue, runJob, {
        ...(connection !== undefined ? { connection } : {}),
        ...workerOptions,
    });
}
