/** Server → panel: a retry was accepted; carries the new attempt's id. */
export type TCNSStimulationRetryAccepted = {
    type: 'stimulation.retry.accepted';
    requestId: string;
    stimulationId: string;
    newStimulationAttemptId: string;
};
