import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSStimulationJobData, TCNSStimulationJobOptions } from './types';

/**
 * Build a queue job from a **registered** collateral. Throws (with the broker's
 * `pkgName` in the message) if the collateral is not in the registry, so a typo
 * can't reach the queue. Each broker package wraps this with its own `pkgName`.
 */
export function cnsStimulationJob(
    registry: CNSPersistOptionsRegistry,
    collateral: CNSCollateral<unknown>,
    payload: unknown,
    stimulationJobOptions?: TCNSStimulationJobOptions,
    pkgName = '@cnstra/broker'
): TCNSStimulationJobData {
    const collateralName = registry.getCollateralName(collateral);
    if (!collateralName) {
        throw new Error(
            `[${pkgName}] Collateral is not registered in the ` +
                'CNSPersistOptionsRegistry; cannot enqueue it by name.'
        );
    }
    const inheritedOptions = stimulationJobOptions?.from?.stimulation?.options;
    const modality = stimulationJobOptions?.modality ?? inheritedOptions?.modality;
    const afferentPath = stimulationJobOptions?.modality !== undefined
        ? stimulationJobOptions.afferentPath
        : stimulationJobOptions?.afferentPath ?? inheritedOptions?.afferentPath;
    const stimulationJobData: TCNSStimulationJobData = { collateralName, payload };
    if (stimulationJobOptions?.maxNeuronHops !== undefined) stimulationJobData.maxNeuronHops = stimulationJobOptions.maxNeuronHops;
    if (modality === undefined) return stimulationJobData;
    const modalityName = registry.getModalityName(modality);
    if (!modalityName) {
        throw new Error(
            `[${pkgName}] Modality is not registered in the ` +
                'CNSPersistOptionsRegistry; cannot enqueue it by name.'
        );
    }
    stimulationJobData.modalityName = modalityName;
    if (afferentPath === undefined) return stimulationJobData;
    const afferentPathName = registry.getAfferentPathName(modality, afferentPath);
    if (!afferentPathName) {
        throw new Error(
            `[${pkgName}] Afferent path is not a key of modality "${modalityName}"; cannot enqueue it by name.`
        );
    }
    stimulationJobData.afferentPathName = afferentPathName;
    return stimulationJobData;
}
