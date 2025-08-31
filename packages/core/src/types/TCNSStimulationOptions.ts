import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSStimulationResponse } from './TCNSStimulationResponse';

export type TCNSStimulationOptions<
    TCollateralId extends string,
    TInputPayload,
    TOutputPayload
> = {
    maxNeuronHops?: number;
    allowType?: (t: string) => boolean;
    onResponse?: (
        response: TCNSStimulationResponse<
            TCollateralId,
            TInputPayload,
            TOutputPayload
        >
    ) => void;
    abortSignal?: AbortSignal;
    stimulationId?: string;
    ctx?: ICNSStimulationContextStore;
    createContextStore?: () => ICNSStimulationContextStore;
    concurrency?: number;
};
