import type { TCNSStimulationCommand } from '../types/TCNSStimulationCommand';

export type TCNSStimulationCommandRequest = {
    type: 'stimulation.command';
    requestId: string;
    stimulationId: string;
    command: TCNSStimulationCommand;
};
