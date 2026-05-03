import type { CNS } from '../CNS';
import type { CNSCollateral } from '../CNSCollateral';
import type { CNSStimulation } from '../CNSStimulation';
import type { TCNSDendrite } from '../types/TCNSDendrite';
import type { TCNSNeuron } from '../types/TCNSNeuron';
import type { TCNSSignal } from '../types/TCNSSignal';
import type { TCNSStimulationOptions } from '../types/TCNSStimulationOptions';
import type { TCNSStimulationResponse } from '../types/TCNSStimulationResponse';

export type TCNSDrainGuardSignal =
    | TCNSSignal<CNSCollateral<unknown>>
    | TCNSSignal<CNSCollateral<unknown>>[];

export type TCNSDrainGuardOptions<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> = {
    cns: CNS<TNeuron, TDendrite>;
    signal: TCNSDrainGuardSignal;
    options?: TCNSStimulationOptions<TCNSStimulationResponse>;
};

export class CNSDrainGuard<
    TNeuron extends TCNSNeuron<any, any>,
    TDendrite extends TCNSDendrite<any, any, any> = TCNSDendrite<any, any, any>
> {
    private currentStimulation?: CNSStimulation<TNeuron, TDendrite>;
    private currentDrain?: Promise<void>;
    private currentAbortController?: AbortController;

    constructor(
        private readonly guardOptions: TCNSDrainGuardOptions<TNeuron, TDendrite>
    ) {}

    public isDraining(): boolean {
        return this.currentDrain !== undefined;
    }

    public getCurrentStimulation():
        | CNSStimulation<TNeuron, TDendrite>
        | undefined {
        return this.currentStimulation;
    }

    public drain(): Promise<void> {
        if (this.currentDrain) return this.currentDrain;

        const stimulation = this.guardOptions.cns.stimulate(
            this.guardOptions.signal,
            this.createStimulationOptions()
        );

        const drain = stimulation.waitUntilComplete().finally(() => {
            if (this.currentDrain !== drain) return;
            this.currentDrain = undefined;
            this.currentStimulation = undefined;
            this.currentAbortController = undefined;
        });

        this.currentStimulation = stimulation;
        this.currentDrain = drain;

        return drain;
    }

    public abort(reason?: any): boolean {
        if (!this.currentAbortController) return false;
        if (this.currentAbortController.signal.aborted) return false;

        this.currentAbortController.abort(reason);
        return true;
    }

    private createStimulationOptions(): TCNSStimulationOptions<TCNSStimulationResponse> {
        const options = this.guardOptions.options;

        if (options?.abortSignal) {
            return options;
        }

        if (typeof AbortController === 'undefined') {
            return options ?? {};
        }

        this.currentAbortController = new AbortController();

        return {
            ...options,
            abortSignal: this.currentAbortController.signal,
        };
    }
}
