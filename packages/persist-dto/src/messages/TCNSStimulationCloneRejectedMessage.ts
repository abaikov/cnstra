/** Server → panel: a clone was rejected. */
export type TCNSStimulationCloneRejectedMessage = {
    type: 'stimulation.clone.rejected';
    requestId: string;
    stimulationId: string;
    reason: string;
};
