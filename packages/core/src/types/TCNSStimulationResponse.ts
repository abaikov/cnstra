import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSSignal } from './TCNSSignal';

export type TCNSStimulationResponse<
    TCollateralId extends string,
    TInputPayload,
    TOutputPayload
> = {
    inputSignal?: TCNSSignal<TCollateralId, TInputPayload>;
    outputSignal?: TCNSSignal<TCollateralId, TOutputPayload>;
    ctx: ICNSStimulationContextStore;
    // Current queue length
    queueLength: number;

    error?: Error;
    // hops passed only if maxHops is set
    hops?: number;
};
