import type { TCNSStimulationActionOptions } from './TCNSStimulationActionOptions';

/**
 * Panel → server: launch a **fresh** stimulation from the stimulation's entry signal
 * (new stimulation, attempt 1). Always available — it is just a re-stimulation.
 */
export type TCNSStimulationCloneMessage = {
    type: 'stimulation.clone';
    requestId: string;
    stimulationId: string;
    options?: TCNSStimulationActionOptions;
};
