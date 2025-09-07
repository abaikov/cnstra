import { TCNSSubscriber } from './TCNSSubscriber';
import { TCNSSignal } from './TCNSSignal';
import { TCNSNeuron } from './TCNSNeuron';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSStimulationQueueItem<
    TCollateralType extends string,
    TNeuronName extends string,
    TNeuron extends TCNSNeuron<
        any,
        TNeuronName,
        TCollateralType,
        any,
        any,
        any,
        any
    >,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> = {
    neuronId: TNeuronName;
    subscriber: TCNSSubscriber<TNeuron, TDendrite>;
    inputSignal?: TCNSSignal<TCollateralType, any>;
};
