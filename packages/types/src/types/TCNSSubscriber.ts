import { TCNSDendrite } from './TCNSDendrite';
import { TCNSNeuron } from './TCNSNeuron';

export type TCNSSubscriber<
    TNeuron extends TCNSNeuron<any>,
    TDendrite extends TCNSDendrite<any, any>
> = {
    neuron: TNeuron;
    dendrite: TDendrite;
};
