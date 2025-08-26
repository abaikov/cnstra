import { TCNSAxon } from './TCNSAxon';
import { TCNDendrite } from './TCNDendrite';

export type TCNSNeuron<
    TId extends string,
    TCollateralId extends string,
    TAxon extends TCNSAxon<TCollateralId, unknown>,
    TSenderCollateralId extends string,
    TDendrites extends TCNDendrite<
        TSenderCollateralId,
        unknown,
        TCollateralId,
        TAxon
    >[]
> = {
    id: TId;
    axon: TAxon;
    dendrites: TDendrites;
};
