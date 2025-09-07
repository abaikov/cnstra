import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSStimulationResponse } from './TCNSStimulationResponse';

export type TCNSStimulationOptions<
    TCollateralType extends string,
    TInputPayload,
    TOutputPayload
> = {
    maxNeuronHops?: number;
    allowType?: (t: string) => boolean;
    onResponse?: (
        response: TCNSStimulationResponse<
            TCollateralType,
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
