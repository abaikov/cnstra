import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSStimulationResponse } from './TCNSStimulationResponse';

export type TCNSStimulationOptions<
    TCollateralName extends string,
    TInputPayload,
    TOutputPayload
> = {
    maxNeuronHops?: number;
    allowName?: (t: string) => boolean;
    onResponse?: (
        response: TCNSStimulationResponse<
            TCollateralName,
            TInputPayload,
            TOutputPayload
        >
    ) => void | Promise<void>;
    abortSignal?: AbortSignal;
    stimulationId?: string;
    ctx?: ICNSStimulationContextStore;
    createContextStore?: () => ICNSStimulationContextStore;
    concurrency?: number;
};
