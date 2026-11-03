import type { TCNSAfferentPath, TCNSModality } from '@cnstra/types';

type TModalityHandler = (payload: any, axon: any, ctx: any) => any;

export type TCNSModalitySelection = {
    modalityConfigs: Array<{
        modality: TCNSModality;
        afferentPaths?: Map<TCNSAfferentPath, TModalityHandler>;
        default?: TModalityHandler;
    }>;
    defaultHandler: TModalityHandler | undefined;
    output: (result: any, axon: any, ctx: any) => any;
};
