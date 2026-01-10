import { CNSCollateral } from '../CNSCollateral';
import { TCNSSignal } from './TCNSSignal';

export type TCNSNeuronActivationTask<
    TNeuron extends object = object,
    TCollateral extends CNSCollateral<unknown> = CNSCollateral<unknown>
> = {
    neuron: TNeuron;
    dendriteCollateral: TCollateral;
    input?: TCNSSignal<TCollateral>;
};

