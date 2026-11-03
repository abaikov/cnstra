import type { ICNSCollateral, ICNSStimulation, TCNSSignal, TCNSStimulationOptions, TCNSStimulationResponse } from '@cnstra/types';

export type TCNSHomeostatCNS = {
    stimulate(signalOrSignals: TCNSSignal<ICNSCollateral<unknown>> | TCNSSignal<ICNSCollateral<unknown>>[], options: TCNSStimulationOptions<TCNSStimulationResponse>): Pick<ICNSStimulation<never>, 'waitUntilComplete'>;
};
