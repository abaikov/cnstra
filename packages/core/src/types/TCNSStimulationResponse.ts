import { ICNSStimulationContextStore } from '../interfaces/ICNSStimulationContextStore';
import { TCNSSignal } from './TCNSSignal';

export type TCNSStimulationResponse<
    TCollateralType extends string,
    TInputPayload,
    TOutputPayload
> = {
    inputSignal?: TCNSSignal<TCollateralType, TInputPayload>;
    outputSignal?: TCNSSignal<TCollateralType, TOutputPayload>;
    ctx: ICNSStimulationContextStore;
    // Current queue length
    queueLength: number;

    error?: Error;
    // hops passed only if maxHops is set
    hops?: number;
};
