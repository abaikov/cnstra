import type { ICNS, ICNSCollateral, ICNSStimulation, TCNSNeuron, TCNSSignal, TCNSStimulationOptions, TCNSStimulationResponse } from '@cnstra/types';
import type { TCNSHomeostatCNS } from './types/TCNSHomeostatCNS';

export class CNSHomeostatForwardingCNS implements TCNSHomeostatCNS {
    private cns: (TCNSHomeostatCNS & Pick<ICNS<TCNSNeuron>, 'batch' | 'addDrainListener'>) | undefined;

    private readonly unboundDrainListeners: (() => void)[] = [];

    public bind(cns: TCNSHomeostatCNS & Pick<ICNS<TCNSNeuron>, 'batch' | 'addDrainListener'>): void {
        this.cns = cns;
        for (const drainListener of this.unboundDrainListeners) cns.addDrainListener(drainListener);
        this.unboundDrainListeners.length = 0;
    }

    public stimulate(
        signalOrSignals: TCNSSignal<ICNSCollateral<unknown>> | TCNSSignal<ICNSCollateral<unknown>>[],
        options: TCNSStimulationOptions<TCNSStimulationResponse>
    ): Pick<ICNSStimulation<never>, 'waitUntilComplete'> {
        return this.boundCNS().stimulate(signalOrSignals, options);
    }

    public batch<TResult>(run: () => TResult): TResult {
        return this.boundCNS().batch(run);
    }

    public addDrainListener(drainListener: () => void): void {
        if (this.cns === undefined) this.unboundDrainListeners.push(drainListener);
        else this.cns.addDrainListener(drainListener);
    }

    private boundCNS(): TCNSHomeostatCNS & Pick<ICNS<TCNSNeuron>, 'batch' | 'addDrainListener'> {
        if (this.cns === undefined) {
            throw new Error('CNSHomeostatForwardingCNS: the CNS is not assembled yet; a homeostat stimulates only after assembleCNSHomeostatSchema returns');
        }
        return this.cns;
    }
}
