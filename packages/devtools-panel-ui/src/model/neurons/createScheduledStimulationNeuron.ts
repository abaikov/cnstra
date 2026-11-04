import { explorerActionAxon } from '../axons/explorerActionAxon';
import type { TCNSScheduledStimulationModel } from '../types/TCNSScheduledStimulationModel';

export function createScheduledStimulationNeuron(options: { scheduledStimulationModel: TCNSScheduledStimulationModel }) {
    const { scheduledStimulationModel } = options;
    return scheduledStimulationModel.createNeuron()
        .dendrite({ collateral: explorerActionAxon.commandAccepted, response: () => { void scheduledStimulationModel.invalidate(); } })
        .dendrite({ collateral: explorerActionAxon.launchAccepted, response: () => { void scheduledStimulationModel.invalidate(); } });
}
