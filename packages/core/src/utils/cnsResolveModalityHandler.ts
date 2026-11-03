import type { TCNSAfferentPath, TCNSModality } from '@cnstra/types';
import type { TCNSModalitySelection } from '../types/TCNSModalitySelection';

export function cnsResolveModalityHandler(
    modalitySelection: TCNSModalitySelection,
    modality: TCNSModality | undefined,
    afferentPath: TCNSAfferentPath | undefined
): ((payload: any, axon: any, ctx: any) => any) | undefined {
    if (modality !== undefined) {
        const modalityConfigs = modalitySelection.modalityConfigs;
        for (let i = 0; i < modalityConfigs.length; i++) {
            const modalityConfig = modalityConfigs[i];
            if (modalityConfig.modality !== modality) continue;
            for (let path = afferentPath; path !== undefined; path = path.parentAfferentPath) {
                const handler = modalityConfig.afferentPaths?.get(path);
                if (handler !== undefined) return handler;
            }
            if (modalityConfig.default !== undefined) return modalityConfig.default;
            break;
        }
    }
    return modalitySelection.defaultHandler;
}
