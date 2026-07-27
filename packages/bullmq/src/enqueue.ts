import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type {
    IBullJob,
    IBullQueueLike,
    TCNSStimulationJobData,
} from './types';

/** Commonly used BullMQ `add` options (a superset is passed through). */
export interface TCNSSendOptions {
    /** Total attempts incl. the first — BullMQ retries the SAME job id. */
    attempts?: number;
    backoff?: number | { type: string; delay?: number };
    delay?: number;
    /** Fix the job id — e.g. one job per entity id (dedupes in-flight). */
    jobId?: string;
    priority?: number;
    removeOnComplete?: boolean | number | { age?: number; count?: number };
    removeOnFail?: boolean | number | { age?: number; count?: number };
    [key: string]: unknown;
}

/** The BullMQ job name stimulations are enqueued under. */
export const CNS_JOB_NAME = 'cns-stimulation';

/**
 * Build a queue job from a **registered** collateral. Throws if the collateral
 * is not in the registry, so a typo can't reach the queue.
 */
export function stimulationJob(
    registry: CNSPersistOptionsRegistry,
    collateral: CNSCollateral<unknown>,
    payload: unknown,
    extra?: Pick<TCNSStimulationJobData, 'maxNeuronHops'>
): TCNSStimulationJobData {
    const collateralName = registry.getCollateralName(collateral);
    if (!collateralName) {
        throw new Error(
            '[@cnstra/bullmq] Collateral is not registered in the ' +
                'CNSPersistOptionsRegistry; cannot enqueue it by name.'
        );
    }
    return { collateralName, payload, ...extra };
}

/** Add a stimulation job to a BullMQ queue. Returns the created job. */
export function enqueueStimulation(
    queue: IBullQueueLike,
    job: TCNSStimulationJobData,
    options?: TCNSSendOptions
): Promise<IBullJob> {
    return queue.add(CNS_JOB_NAME, job as unknown as object, options);
}
