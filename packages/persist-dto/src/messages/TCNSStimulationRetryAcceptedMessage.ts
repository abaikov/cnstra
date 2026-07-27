/** Server → panel: a retry was accepted; carries the new attempt's id. */
export type TCNSStimulationRetryAcceptedMessage = {
    type: 'stimulation.retry.accepted';
    requestId: string;
    stimulationId: string;
    newStimulationAttemptId: string;
};
