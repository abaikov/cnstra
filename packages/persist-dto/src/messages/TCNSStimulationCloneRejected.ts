/** Server → panel: a clone was rejected. */
export type TCNSStimulationCloneRejected = {
    type: 'stimulation.clone.rejected';
    requestId: string;
    stimulationId: string;
    reason: string;
};
