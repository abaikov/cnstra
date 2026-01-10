import type { TCNSNeuron } from '../types/TCNSNeuron';
import type { TCNSDendrite } from '../types/TCNSDendrite';
import type { TCNSOptions } from '../types/TCNSOptions';
import type { TCNSStimulationOptions } from '../types/TCNSStimulationOptions';
import type { TCNSSignal } from '../types/TCNSSignal';
import type { TCNSStimulationResponse } from '../types/TCNSStimulationResponse';
import type { CNSNetwork } from '../CNSNetwork';
import type { CNSStimulation } from '../CNSStimulation';
import type { CNSCollateral } from '../CNSCollateral';

export interface ICNS<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> {
    options?: TCNSOptions;

    network: CNSNetwork<TNeuron, TDendrite>;

    /**
     * Add a global response listener applied to all stimulations.
     * Returns an unsubscribe function.
     */
    addResponseListener(
        listener: (
            response: TCNSStimulationResponse
        ) => void
    ): () => void;

    stimulate(
        signalOrSignals:
            | TCNSSignal<CNSCollateral<unknown>>
            | TCNSSignal<CNSCollateral<unknown>>[],
        options?: TCNSStimulationOptions<TCNSStimulationResponse>
    ): CNSStimulation<TNeuron, TDendrite>;
}
