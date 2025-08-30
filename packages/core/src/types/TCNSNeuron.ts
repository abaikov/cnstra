import { TCNSAxon } from './TCNSAxon';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSNeuron<
    TId extends string,
    TCollateralId extends string,
    TCollateralPayload,
    TSenderCollateralId extends string,
    TSenderCollateralPayload,
    TDendrites extends TCNSDendrite<
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
