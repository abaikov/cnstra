import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSStimulationJobData } from './types';

/**
 * Build a queue job from a **registered** collateral. Throws (with the broker's
 * `pkgName` in the message) if the collateral is not in the registry, so a typo
 * can't reach the queue. Each broker package wraps this with its own `pkgName`.
 */
export function stimulationJob(
    registry: CNSPersistOptionsRegistry,
    collateral: CNSCollateral<unknown>,
    payload: unknown,
    extra?: Pick<TCNSStimulationJobData, 'maxNeuronHops'>,
    pkgName = '@cnstra/broker'
): TCNSStimulationJobData {
    const collateralName = registry.getCollateralName(collateral);
    if (!collateralName) {
        throw new Error(
            `[${pkgName}] Collateral is not registered in the ` +
                'CNSPersistOptionsRegistry; cannot enqueue it by name.'
        );
    }
    return { collateralName, payload, ...extra };
}
