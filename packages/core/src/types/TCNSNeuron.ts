import { TCNSAxon } from './TCNSAxon';
import { TCNDendrite } from './TCNDendrite';

export type TCNSNeuron<
    TId extends string,
    TCollateralId extends string,
    TCollateralPayload,
    TSenderCollateralId extends string,
    TSenderCollateralPayload,
    TDendrites extends TCNDendrite<
        TSenderCollateralId,
        TSenderCollateralPayload,
        TCollateralId,
        TCollateralPayload,
        TCNSAxon<TCollateralId, TCollateralPayload>
    >[]
> = {
    id: TId;
    axon: TCNSAxon<TCollateralId, TCollateralPayload>;
    dendrites: TDendrites;
};
