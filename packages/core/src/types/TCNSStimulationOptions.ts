import { TCNSStimulationResponse } from './TCNSStimulationResponse';
import { TCNSStimulationSerializedContextValue } from './TCNSStimulationSerializedContextValue';
import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSModality } from './TCNSModality';
import { TCNSAfferentPath } from './TCNSAfferentPath';

export type TCNSStimulationOptions<
    TCollateralName extends string,
    TInputPayload,
    TOutputPayload,
    TNeuronName extends string = string,
    TModalityName extends string = string,
    TAfferentPathName extends string = string,
    TParentAfferentPathName extends string = string,
    TStimulationContext extends Object = {}
> = {
    maxNeuronHops?: number;
    allowName?: (t: string) => boolean;
    onResponse?: (
        response: TCNSStimulationResponse<
            TCollateralName,
            TInputPayload,
            TOutputPayload,
            TNeuronName
        >
    ) => void | Promise<void>;
    abortSignal?: AbortSignal;
    stimulationId?: string;
    contextValues?: TCNSStimulationSerializedContextValue;
    ctx?: ICNSStimulationContextStore;
    concurrency?: number;
    modality?: TCNSModality<
        TModalityName,
        TAfferentPathName,
        TParentAfferentPathName
    >;
    afferentPath?: TCNSAfferentPath<TAfferentPathName, TParentAfferentPathName>;
    stimulationContext?: TStimulationContext;
};
