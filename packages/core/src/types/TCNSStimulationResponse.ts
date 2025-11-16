import { TCNSSignal } from './TCNSSignal';
import { TCNSStimulationSerializedContextValue } from './TCNSStimulationSerializedContextValue';
import { CNSStimulation } from '../CNSStimulation';
import { TCNSNeuron } from './TCNSNeuron';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSStimulationResponse<
    TCollateralName extends string,
    TInputPayload,
    TOutputPayload,
    TNeuronName extends string = string
> = {
    stimulationId?: string;
    inputSignal?: TCNSSignal<TCollateralName, TInputPayload>;
    outputSignal?: Omit<
        TCNSSignal<TCollateralName, TOutputPayload>,
        'payload'
    > & {
        payload?: unknown;
    };
    contextValue: TCNSStimulationSerializedContextValue;
    // Current queue length
    queueLength: number;
    // Reference to the stimulation instance for lazy access to activation tasks
    stimulation: CNSStimulation<
        TCollateralName,
        TNeuronName,
        TCNSNeuron<any, TNeuronName, TCollateralName, any, any, any, any>,
        TCNSDendrite<any, any, any, any, any, any>,
        TInputPayload,
        TOutputPayload
    >;

    error?: Error;
    // hops passed only if maxHops is set
    hops?: number;
};
