import { TCNSSubscriber } from './TCNSSubscriber';
import { TCNSSignal } from './TCNSSignal';
import { TCNSNeuron } from './TCNSNeuron';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSStimulationQueueItem<
    TCollateralId extends string,
    TNeuronId extends string,
    TNeuron extends TCNSNeuron<any, TNeuronId, TCollateralId, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> = {
    neuronId: TNeuronId;
    subscriber: TCNSSubscriber<TNeuron, TDendrite>;
    inputSignal?: TCNSSignal<TCollateralId, any>;
};
