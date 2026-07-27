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
} from '@cnstra/persist';
import type { ICNS, TCNSStimulationResponse } from '@cnstra/types';
import type {
    IPgBossLike,
    IPgBossJob,
    ICNSResponseLike,
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
     * Optional durable **resume**. When set, the worker records the run's
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
export function createCNSWorker(options: TCNSWorkerOptions): Promise<string> {
    const { boss, cns, registry, queue, observe, resume, workOptions } =
        options;

    // One serializer per worker; the recorder is per-job (holds job-specific key).
    const serializer = resume
        ? new CNSProgressSerializer(registry)
        : undefined;

    const runJob = async (
        job: IPgBossJob<TCNSStimulationJobData>
    ): Promise<void> => {
        const { collateralName, payload, maxNeuronHops } = job.data;
        const collateral = registry.getCollateral(collateralName);
        if (!collateral) {
            throw new Error(
                `[@cnstra/pg-boss] Unknown collateral "${collateralName}". ` +
                    `Register it in the CNSPersistOptionsRegistry.`
            );
        }

        // Records the outstanding frontier as the run advances (crash-safety); the
        // explicit save on failure below guarantees the exact final frontier.
        const recorder =
            resume && serializer
                ? new CNSProgressRecorder({
                      serializer,
                      repository: resume.repository,
                      key: job.id,
                      strategy: resume.strategy,
                  })
                : undefined;

        // Observability: stream the canonical name-based Stimulation → Attempt →
        // Task model to `observe`. One job = one stimulation; each pg-boss retry is
        // a new attempt (retryCount is 0-based).
        const attemptNumber = (job.retryCount ?? 0) + 1;
        const persistor = observe
            ? new CNSStimulationPersistor({
                  repository: observe,
                  registry,
                  stimulationId: job.id,
                  stimulationAttemptId: `${job.id}#${attemptNumber}`,
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

        // Correlate logs to this run: every handler reads `ctx.stimulationContext`
        // (same object on every hop, sync or async) — no wiring on the user's side.
        const stimulationContext = { stimulationId: job.id, attemptNumber };

        // Resume from a persisted frontier if this job already has one (a retry of
        // the same job id); otherwise start fresh from the entry signal.
        let stimulation;
        if (resume && serializer) {
            const saved = await resume.repository.load(job.id);
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
            if (resume) await resume.repository.delete(job.id);
        } catch (err) {
            // Persist the exact final frontier before throwing so the retried job
            // resumes from it (the recorder's cadence may still be debouncing).
            if (resume && serializer) {
                await resume.repository.save(
                    job.id,
                    serializer.serialize(stimulation)
                );
            }
            // Let pg-boss decide about retries/backoff.
            throw err;
        } finally {
            recorder?.dispose();
            persistor?.dispose();
        }
    };

    const handler = async (
        jobs: IPgBossJob<TCNSStimulationJobData>[]
    ): Promise<void> => {
        for (const job of jobs) {
            await runJob(job);
        }
    };

    return workOptions
        ? boss.work<TCNSStimulationJobData>(queue, workOptions, handler)
        : boss.work<TCNSStimulationJobData>(queue, handler);
}
