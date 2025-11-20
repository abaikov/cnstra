import { TCNSStimulationResponse } from './TCNSStimulationResponse';
import { TCNSStimulationSerializedContextValue } from './TCNSStimulationSerializedContextValue';
import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';

import { TCNSNeuron } from './TCNSNeuron';
import { TCNSDendrite } from './TCNSDendrite';

export type TCNSStimulationOptions<
    TCollateralName extends string,
    TInputPayload,
    TOutputPayload,
    TNeuronName extends string = string,
    TNeuron extends TCNSNeuron<
        any,
        TNeuronName,
        TCollateralName,
        any,
        any,
        any,
        any
    > = TCNSNeuron<any, TNeuronName, TCollateralName, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any> = TCNSDendrite<
        any,
        any,
        any,
        any,
        any,
        any
    >
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
};
