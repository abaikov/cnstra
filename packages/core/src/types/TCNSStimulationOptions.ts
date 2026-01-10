import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSModality } from './TCNSModality';
import { TCNSAfferentPath } from './TCNSAfferentPath';

export type TCNSStimulationOptions<
    TResponse,
    TStimulationContext extends Object = {}
> = {
    maxNeuronHops?: number;
    onResponse?: (response: TResponse) => void | Promise<void>;
    abortSignal?: AbortSignal;
    ctx?: ICNSStimulationContextStore;
    concurrency?: number;
    modality?: TCNSModality;
    afferentPath?: TCNSAfferentPath;
    stimulationContext?: TStimulationContext;
};
