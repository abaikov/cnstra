import { CNSCollateral } from '../CNSCollateral';
import { TCNSDendrite } from '../types/TCNSDendrite';
import { TCNSNeuron } from '../types/TCNSNeuron';
import { TCNSSubscriber } from '../types/TCNSSubscriber';
import { TCNSOptions } from '../types/TCNSOptions';
import { TCNSSignal } from '../types/TCNSSignal';

export interface ICNS<
    TNeuron extends TCNSNeuron<any, any, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> {
    options?: TCNSOptions;
    getParentNeuronByCollateralName(
        collateralName: string
    ): TNeuron | undefined;
    getSCCSetByNeuronName(neuronName: string): Set<string> | undefined;
    getSccIndexByNeuronName(neuronName: string): number | undefined;
    getSubscribers(
        collateralName: string
    ): TCNSSubscriber<TNeuron, TDendrite>[];
    canNeuronBeGuaranteedDone(
        neuronName: string,
        activeSccCounts: Map<number, number>
    ): boolean;
    readonly stronglyConnectedComponents: Set<string>[];

    /**
     * Add a global response listener applied to all stimulations.
     * Returns an unsubscribe function.
     */
    addResponseListener(listener: (response: any) => void): () => void;

    /**
     * Wrap a local onResponse with all global listeners.
     */
    wrapOnResponse<T>(local?: (response: T) => void): (response: T) => void;

    getDendrites(): TDendrite[];
    getCollaterals(): CNSCollateral<any, any>[];
    getNeurons(): TNeuron[];
    stimulate(signal: TCNSSignal<any, any>): void;
}
