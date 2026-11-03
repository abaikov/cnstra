import {
    CNSProgressRecorder,
    CNSProgressSerializer,
    CNSStimulationPersistor,
} from '@cnstra/persist';
import type {
    CNSPersistOptionsRegistry,
    ICNSProgressRepository,
    ICNSProgressRecordingStrategy,
    ICNSStimulationWriter,
} from '@cnstra/persist';
import type {
    ICNS,
    ICNSStimulation,
    TCNSContextStore,
    TCNSStimulationResponse,
} from '@cnstra/types';
import { buildCNSAttemptId } from '@cnstra/persist-dto';
import type { ICNSResponseLike } from './types';

/**
 * Everything a broker worker needs to run ONE job as ONE stimulation. The broker
 * package resolves its own bits (`jobId`, `attemptNumber`, the resume checkpoint
 * store) and hands them here; this function is broker-agnostic.
 */
export type TCNSRunStimulationJobParams = {
    /** Package label for error messages, e.g. `@cnstra/bullmq`. */
    pkgName: string;
    /** True iff the worker is shutting down — the job is rejected so it retries later. */
    stopping?: boolean;
    cns: ICNS<any, any>;
    registry: CNSPersistOptionsRegistry;
    /** Stable id: one job = one stimulation (`stimulationId` = job id). */
    jobId: string;
    collateralName: string;
    payload: unknown;
    maxNeuronHops?: number;
    modalityName?: string;
    afferentPathName?: string;
    /** 1-based; each broker retry of the same job id = a new attempt. */
    attemptNumber: number;
    /** Observability history store (name-based Stimulation→Attempt→Task). */
    observe?: ICNSStimulationWriter;
    /** Present iff resume is enabled (one serializer per worker). */
    serializer?: CNSProgressSerializer;
    /** Resolved resume checkpoint store (native job-progress or an external repo). */
    resumeRepo?: ICNSProgressRepository;
    resumeStrategy?: ICNSProgressRecordingStrategy;
    /** Shared abort — aborting turns the remaining tasks into the resumable frontier. */
    abort: AbortController;
    /** In-flight set, so shutdown can drain/abort. This fn add/deletes its stimulation. */
    active?: Set<ICNSStimulation<any>>;
    onResponse?: (response: TCNSStimulationResponse) => void;
    stimulationContext?: TCNSContextStore;
};

/**
 * Reconstruct the entry signal by name, resume from a persisted frontier if this
 * job already has one (else start fresh), stream per-hop progress to the resume
 * checkpoint + observability history, and await completion. On failure it saves the
 * exact final frontier before rethrowing so the retried job resumes from it; on
 * success it drops the checkpoint. Rethrows so the broker applies its retry/backoff.
 */
export async function runCNSStimulationJob(
    p: TCNSRunStimulationJobParams
): Promise<void> {
    if (p.stopping) {
        throw new Error(`[${p.pkgName}] worker is shutting down; job will retry`);
    }
    const collateral = p.registry.getCollateral(p.collateralName);
    if (!collateral) {
        throw new Error(
            `[${p.pkgName}] Unknown collateral "${p.collateralName}". ` +
                `Register it in the CNSPersistOptionsRegistry.`
        );
    }

    const resumeOn = !!(p.serializer && p.resumeRepo);

    // Records the outstanding frontier as the run advances (crash-safety); the
    // explicit save on failure below guarantees the exact final frontier.
    const recorder = resumeOn
        ? new CNSProgressRecorder({
              serializer: p.serializer!,
              repository: p.resumeRepo!,
              key: p.jobId,
              strategy: p.resumeStrategy,
          })
        : undefined;

    // Observability: stream the canonical name-based Stimulation → Attempt → Task
    // model. One job = one stimulation; each broker retry is a new attempt.
    const persistor = p.observe
        ? new CNSStimulationPersistor({
              repository: p.observe,
              registry: p.registry,
              stimulationId: p.jobId,
              stimulationAttemptId: buildCNSAttemptId(p.jobId, p.attemptNumber),
              attemptNumber: p.attemptNumber,
              entry: [{ collateralName: p.collateralName, payload: p.payload }],
              volume: 'full',
          })
        : undefined;

    const onResponse = (resp: ICNSResponseLike) => {
        const r = resp as unknown as TCNSStimulationResponse;
        recorder?.onResponse(r);
        persistor?.onResponse(r);
        p.onResponse?.(r);
    };

    // Correlate logs to this run: every handler reads `ctx.stimulationContext`
    // (same object on every hop, sync or async) — no wiring on the user's side.
    const stimulationContext = {
        ...p.stimulationContext,
        stimulationId: p.jobId,
        attemptNumber: p.attemptNumber,
    };

    let stimulation: ICNSStimulation<any> | undefined;
    if (resumeOn) {
        const saved = await p.resumeRepo!.load(p.jobId);
        if (saved) {
            const { tasks, stimulationContext: restored, modality, afferentPath } =
                p.serializer!.hydrate(saved);
            stimulation = p.cns.activate(tasks, {
                modality,
                afferentPath,
                maxNeuronHops: p.maxNeuronHops,
                onResponse,
                // What the previous attempt attached to the run (a traceparent,
                // a request id) comes back; this worker's own keys go on top,
                // because `attemptNumber` belongs to THIS attempt, not that one.
                stimulationContext: { ...restored, ...stimulationContext },
                abortSignal: p.abort.signal,
            });
        }
    }
    if (!stimulation) {
        const modality = p.modalityName !== undefined ? p.registry.getModality(p.modalityName) : undefined;
        if (p.modalityName !== undefined && modality === undefined) {
            throw new Error(
                `[${p.pkgName}] Unknown modality "${p.modalityName}". ` +
                    `Register it in the CNSPersistOptionsRegistry.`
            );
        }
        const afferentPath = modality !== undefined && p.afferentPathName !== undefined
            ? p.registry.getAfferentPath(modality, p.afferentPathName)
            : undefined;
        if (p.afferentPathName !== undefined && afferentPath === undefined) {
            throw new Error(
                `[${p.pkgName}] Unknown afferent path "${p.afferentPathName}" in modality "${p.modalityName}".`
            );
        }
        stimulation = p.cns.stimulate(collateral.createSignal(p.payload), {
            modality,
            afferentPath,
            maxNeuronHops: p.maxNeuronHops,
            onResponse,
            stimulationContext,
            abortSignal: p.abort.signal,
        });
    }

    p.active?.add(stimulation);
    try {
        await stimulation.waitUntilComplete();
        // Job about to complete → its resume checkpoint can go (lifecycle = job row).
        if (p.resumeRepo) await p.resumeRepo.delete(p.jobId);
    } catch (err) {
        // Persist the exact final frontier before throwing so the retried job
        // resumes from it (an abort on shutdown lands here too → exact frontier).
        if (resumeOn) {
            await p.resumeRepo!.save(p.jobId, p.serializer!.serialize(stimulation));
        }
        throw err;
    } finally {
        p.active?.delete(stimulation);
        recorder?.dispose();
        // Awaited: dispose hands back the outstanding writes, and on a shutdown
        // drain the process can otherwise exit before the terminal record lands.
        await persistor?.dispose();
    }
}
