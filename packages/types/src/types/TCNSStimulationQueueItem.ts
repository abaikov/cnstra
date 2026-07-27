import { TCNSSubscriber } from './TCNSSubscriber';
import { TCNSSignal } from './TCNSSignal';
import { TCNSNeuron } from './TCNSNeuron';
import { TCNSDendrite } from './TCNSDendrite';
import { ICNSCollateral } from '../interfaces/ICNSCollateral';

export type TCNSStimulationQueueItem<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any>,
    TInputCollateral extends ICNSCollateral<unknown> = ICNSCollateral<unknown>
> = {
    neuron: TNeuron;
    subscriber: TCNSSubscriber<TNeuron, TDendrite>;
    inputSignal?: TCNSSignal<TInputCollateral>;
};
