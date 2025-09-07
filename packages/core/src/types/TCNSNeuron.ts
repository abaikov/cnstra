import { TCNSAxon } from './TCNSAxon';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSNeuron<
    TContextValue,
    TName extends string,
    TCollateralType extends string,
    TCollateralPayload,
    TSenderCollateralType extends string,
    TSenderCollateralPayload,
    TAxonType extends TCNSAxon<TCollateralType, TCollateralPayload>
> = {
    name: TName;
    axon: TAxonType;
    /** Optional per-neuron concurrency limit. If undefined or <= 0, no limit is applied. */
    concurrency?: number;
    dendrites: TCNSDendrite<
        TContextValue,
        TSenderCollateralType,
        TSenderCollateralPayload,
        TCollateralType,
        TCollateralPayload,
        TAxonType
    >[];
};
