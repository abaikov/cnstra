import type { TCNSStimulationActionOptions } from './TCNSStimulationActionOptions';

/**
 * Panel → server: **resume** a stimulation's outstanding frontier (same stimulation,
 * +1 attempt). A delivery that can't resume answers with
 * {@link TCNSStimulationRetryRejectedMessage}.
 */
export type TCNSStimulationRetryMessage = {
    type: 'stimulation.retry';
    requestId: string;
    stimulationId: string;
    options?: TCNSStimulationActionOptions;
};
