import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import { stimulationJob as brokerStimulationJob } from '@cnstra/broker';
import type { IPgBossLike, TCNSStimulationJobData } from './types';

/** Commonly used pg-boss send options (a superset is passed through). */
export interface TCNSSendOptions {
    retryLimit?: number;
    retryBackoff?: boolean;
    retryDelay?: number;
    /** One in-flight job per key — e.g. one stimulation per entity id. */
    singletonKey?: string;
    startAfter?: number | string | Date;
    expireInSeconds?: number;
    priority?: number;
    [key: string]: unknown;
}

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
    return brokerStimulationJob(registry, collateral, payload, extra, '@cnstra/pg-boss');
}

/** Send a stimulation job to a pg-boss queue. Returns the job id. */
export function enqueueStimulation(
    boss: IPgBossLike,
    queue: string,
    job: TCNSStimulationJobData,
    options?: TCNSSendOptions
): Promise<string | null> {
    return boss.send(queue, job as unknown as object, options);
}
