import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSSignal } from './TCNSSignal';

export type TCNSStimulationResponse<
    TCollateralName extends string,
    TInputPayload,
    TOutputPayload
> = {
    inputSignal?: TCNSSignal<TCollateralName, TInputPayload>;
    outputSignal?: TCNSSignal<TCollateralName, TOutputPayload>;
    ctx: ICNSStimulationContextStore;
    // Current queue length
    queueLength: number;

    error?: Error;
    // hops passed only if maxHops is set
    hops?: number;
};
