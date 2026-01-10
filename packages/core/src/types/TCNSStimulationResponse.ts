import { TCNSSignal } from './TCNSSignal';
import { CNSStimulation } from '../CNSStimulation';
import { TCNSModality } from './TCNSModality';
import { TCNSAfferentPath } from './TCNSAfferentPath';
import { CNSCollateral } from '../CNSCollateral';

export type TCNSStimulationResponse<
    TInputCollateral extends CNSCollateral<unknown> = CNSCollateral<unknown>,
    TOutputCollateral extends CNSCollateral<unknown> = CNSCollateral<unknown>
> = {
    inputSignal?: TCNSSignal<TInputCollateral>;
    outputSignal?: TCNSSignal<TOutputCollateral>;
    modality?: TCNSModality;
    afferentPath?: TCNSAfferentPath;
    contextValue: Map<object, unknown>;
    // Current queue length
    queueLength: number;
    // Reference to the stimulation instance for lazy access to activation tasks
    stimulation: CNSStimulation<any, any>;

    error?: Error;
    // hops passed only if maxHops is set
    hops?: number;
};
