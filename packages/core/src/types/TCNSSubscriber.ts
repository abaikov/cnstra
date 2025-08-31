import { TCNSDendrite } from './TCNSDendrite';
import { TCNSNeuron } from './TCNSNeuron';

export type TCNSSubscriber<
    TNeuron extends TCNSNeuron<any, any, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> = {
    neuron: TNeuron;
    dendrite: TDendrite;
};
