import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { stimulationJob as brokerStimulationJob } from '@cnstra/broker';
import type { TCNSStimulationJobOptions } from '@cnstra/broker';
import type {
    ICNSBullJob,
    ICNSBullQueueLike,
    TCNSStimulationJobData,
} from './types';

/** Commonly used BullMQ `add` options (a superset is passed through). */
export type TCNSSendOptions = {
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
};

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
    stimulationJobOptions?: TCNSStimulationJobOptions
): TCNSStimulationJobData {
    return brokerStimulationJob(registry, collateral, payload, stimulationJobOptions, '@cnstra/bullmq');
}

/** Add a stimulation job to a BullMQ queue. Returns the created job. */
export function enqueueCNSStimulation(
    queue: ICNSBullQueueLike,
    job: TCNSStimulationJobData,
    options?: TCNSSendOptions
): Promise<ICNSBullJob> {
    return queue.add(CNS_JOB_NAME, job, options);
}
