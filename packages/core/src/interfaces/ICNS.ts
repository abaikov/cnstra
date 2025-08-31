import { TCNSDendrite } from '../types/TCNSDendrite';
import { TCNSNeuron } from '../types/TCNSNeuron';
import { TCNSSubscriber } from '../types/TCNSSubscriber';
import { TCNSOptions } from '../types/TCNSOptions';

export interface ICNS<
    TNeuron extends TCNSNeuron<any, any, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> {
    options?: TCNSOptions;
    getParentNeuronByCollateralId(collateralId: string): TNeuron | undefined;
    getSCCSetByNeuronId(neuronId: string): Set<string> | undefined;
    getSccIndexByNeuronId(neuronId: string): number | undefined;
    getSubscribers(collateralId: string): TCNSSubscriber<TNeuron, TDendrite>[];
    canNeuronBeGuaranteedDone(
        neuronId: string,
        activeSccCounts: Map<number, number>
    ): boolean;
    readonly stronglyConnectedComponents: Set<string>[];
}
