import { TCNSAxon } from './TCNSAxon';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSNeuron<
    TContextValue,
    TId extends string,
    TCollateralId extends string,
    TCollateralPayload,
    TSenderCollateralId extends string,
    TSenderCollateralPayload,
    TAxonType extends TCNSAxon<TCollateralId, TCollateralPayload>
> = {
    id: TId;
    axon: TAxonType;
    dendrites: TCNSDendrite<
        TContextValue,
        TSenderCollateralId,
        TSenderCollateralPayload,
        TCollateralId,
        TCollateralPayload,
        TAxonType
    >[];
};
