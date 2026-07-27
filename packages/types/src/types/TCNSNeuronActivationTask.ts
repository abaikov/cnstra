import { ICNSCollateral } from '../interfaces/ICNSCollateral';
import { TCNSSignal } from './TCNSSignal';

export type TCNSNeuronActivationTask<
    TNeuron extends object = object,
    TCollateral extends ICNSCollateral<unknown> = ICNSCollateral<unknown>
> = {
    neuron: TNeuron;
    dendriteCollateral: TCollateral;
    input?: TCNSSignal<TCollateral>;
};

