import type { TCNSNeuron } from '../types/TCNSNeuron';
import type { TCNSDendrite } from '../types/TCNSDendrite';
import type { TCNSOptions } from '../types/TCNSOptions';
import type { TCNSStimulationOptions } from '../types/TCNSStimulationOptions';
import type { TCNSSignal } from '../types/TCNSSignal';
import type { TCNSStimulationResponse } from '../types/TCNSStimulationResponse';
import type { CNSNetwork } from '../CNSNetwork';
import type { CNSStimulation } from '../CNSStimulation';

export interface ICNS<
    TCollateralName extends string,
    TNeuronName extends string,
    TNeuron extends TCNSNeuron<
        any,
        TNeuronName,
        TCollateralName,
        any,
        any,
        any,
        any
    >,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any> = TCNSDendrite<
        any,
        any,
        any,
        any,
        any,
        any
    >
> {
    options?: TCNSOptions;

    network: CNSNetwork<TCollateralName, TNeuronName, TNeuron, TDendrite>;

    /**
     * Add a global response listener applied to all stimulations.
     * Returns an unsubscribe function.
     */
    addResponseListener<TInputPayload, TOutputPayload>(
        listener: (
            response: TCNSStimulationResponse<
                TCollateralName,
                TInputPayload,
                TOutputPayload,
                TNeuronName
            >
        ) => void
    ): () => void;

    stimulate<
        TInputPayload extends TOutputPayload,
        TOutputPayload = TInputPayload
    >(
        signalOrSignals:
            | TCNSSignal<TCollateralName, TInputPayload>
            | TCNSSignal<TCollateralName, TInputPayload>[],
        options?: TCNSStimulationOptions<
            TCollateralName,
            TInputPayload,
            TOutputPayload,
            TNeuronName,
            TNeuron,
            TDendrite
        >
    ): CNSStimulation<
        TCollateralName,
        TNeuronName,
        TNeuron,
        TDendrite,
        TInputPayload,
        TOutputPayload
    >;
}
