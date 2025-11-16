import { TCNSSignal } from './TCNSSignal';

export type TCNSNeuronActivationTask<
    TCollateralName extends string = string,
    TNeuronName extends string = string
> = {
    stimulationId: string;
    neuronId: TNeuronName;
    dendriteCollateralName: TCollateralName;
    input?: TCNSSignal<TCollateralName, any>;
};

