import type { TCNSNeuron } from '../types/TCNSNeuron';
import type { TCNSDendrite } from '../types/TCNSDendrite';
import type { TCNSOptions } from '../types/TCNSOptions';
import type { TCNSStimulationOptions } from '../types/TCNSStimulationOptions';
import type { TCNSSignal } from '../types/TCNSSignal';
import type { TCNSStimulationResponse } from '../types/TCNSStimulationResponse';
import type { TCNSStimulationDrain } from '../types/TCNSStimulationDrain';
import type { TCNSNeuronActivationTask } from '../types/TCNSNeuronActivationTask';
import type { ICNSNetwork } from './ICNSNetwork';
import type { ICNSStimulation } from './ICNSStimulation';
import type { ICNSCollateral } from './ICNSCollateral';

export interface ICNS<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> {
    options?: TCNSOptions;

    network: ICNSNetwork<TNeuron, TDendrite>;

    /**
     * Add a global response listener applied to all stimulations.
     * Returns an unsubscribe function.
     */
    addResponseListener(
        listener: (
            response: TCNSStimulationResponse
        ) => void
    ): () => void;

    /**
     * Add a global batch-boundary listener applied to all stimulations, called
     * once at the end of every synchronous turn.
     * Returns an unsubscribe function.
     */
    addDrainListener(listener: (drain: TCNSStimulationDrain) => void): () => void;

    stimulate(
        signalOrSignals:
            | TCNSSignal<ICNSCollateral<unknown>>
            | TCNSSignal<ICNSCollateral<unknown>>[],
        options?: TCNSStimulationOptions<TCNSStimulationResponse>
    ): ICNSStimulation<TNeuron, TDendrite>;

    /**
     * Resume a run from a set of activation tasks (e.g. an outstanding frontier
     * hydrated from persisted progress, or `getFailedTasks()` for a partial
     * retry). Unlike {@link stimulate}, no entry signal is derived — the given
     * tasks are enqueued directly. Pass `options.ctx` to restore neuron context.
     */
    activate(
        tasks: TCNSNeuronActivationTask<TNeuron>[],
        options?: TCNSStimulationOptions<TCNSStimulationResponse>
    ): ICNSStimulation<TNeuron, TDendrite>;
}
