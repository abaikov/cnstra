/** Server → panel: a clone was accepted; carries the fresh stimulation + its first attempt. */
export type TCNSStimulationCloneAcceptedMessage = {
    type: 'stimulation.clone.accepted';
    requestId: string;
    /** The cloned-from stimulation. */
    stimulationId: string;
    newStimulationId: string;
    newStimulationAttemptId: string;
};
