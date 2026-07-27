import type { TCNSNeuron } from '../types/TCNSNeuron';
import type { TCNSDendrite } from '../types/TCNSDendrite';
import type { TCNSSubscriber } from '../types/TCNSSubscriber';
import type { ICNSCollateral } from './ICNSCollateral';

/**
 * The public contract of the compiled neuron network, exposed on `ICNS.network`.
 * The concrete `CNSNetwork` class in `@cnstra/core` implements it.
 */
export interface ICNSNetwork<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> {
    readonly stronglyConnectedComponents: Set<TNeuron>[];
    getSCCSetByNeuron(neuron: TNeuron): Set<TNeuron> | undefined;
    getSccIndexByNeuron(neuron: TNeuron): number | undefined;
    canNeuronBeGuaranteedDone(
        neuron: TNeuron,
        activeSccCounts: Map<number, number>
    ): boolean;
    getParentNeuronByCollateral(
        collateral: ICNSCollateral<unknown>
    ): TNeuron | undefined;
    getDendrites(): TDendrite[];
    getCollaterals(): ICNSCollateral<unknown>[];
    getSubscribers(
        collateral: ICNSCollateral<unknown>
    ): TCNSSubscriber<TNeuron, TDendrite>[];
}
