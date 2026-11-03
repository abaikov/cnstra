export type TCNSStimulationCommandRejected = {
    type: 'stimulation.command.rejected';
    requestId: string;
    stimulationId: string;
    reason: string;
};
