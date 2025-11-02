import { TCNSSignal } from './TCNSSignal';

export type TCNSSerializedQueueItem<
    TCollateralName extends string = string,
    TNeuronName extends string = string
> = {
    neuronId: TNeuronName;
    dendriteCollateralName: TCollateralName;
    input?: TCNSSignal<TCollateralName, any>;
};
