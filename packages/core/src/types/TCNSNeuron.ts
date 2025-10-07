import { TCNSAxon } from './TCNSAxon';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSNeuron<
    TContextValue,
    TName extends string,
    TCollateralName extends string,
    TCollateralPayload,
    TSenderCollateralName extends string,
    TSenderCollateralPayload,
    TAxonType extends TCNSAxon<TCollateralName, TCollateralPayload>
> = {
    name: TName;
    axon: TAxonType;
    /** Optional per-neuron concurrency limit. If undefined or <= 0, no limit is applied. */
    concurrency?: number;
    dendrites: TCNSDendrite<
        TContextValue,
        TSenderCollateralName,
        TSenderCollateralPayload,
        TCollateralName,
        TCollateralPayload,
        TAxonType
    >[];
};
