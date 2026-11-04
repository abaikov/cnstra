import { neuron } from '@cnstra/core';
import type { CNSOIMDBHomeostatEnvironment } from '@cnstra/oimdb';
import { explorerActionAxon } from '../axons/explorerActionAxon';
import { stimulationAxon } from '../axons/stimulationAxon';
import { CNSExplorerSyncKeys } from '../CNSExplorerSyncKeys';
import type { TCNSDevToolsReceptors } from '../types/TCNSDevToolsReceptors';
import type { TCNSStimulationModel } from '../types/TCNSStimulationModel';

export function createStimulationNeuron(options: {
    stimulationModel: TCNSStimulationModel;
    homeostatReceptors: TCNSDevToolsReceptors;
    homeostatEnvironment: CNSOIMDBHomeostatEnvironment;
}) {
    const { stimulationModel, homeostatReceptors, homeostatEnvironment } = options;
    const invalidateStimulationDetail = (stimulationId: string): void => {
        void homeostatEnvironment.invalidate(homeostatReceptors.stimulationDetail, CNSExplorerSyncKeys.stimulationDetail(stimulationId));
    };
    return neuron(stimulationAxon)
        .dendrite(stimulationModel.homeostatDendrites)
        .dendrite({
            collateral: stimulationAxon.stimulationsChanged,
            response: ({ stimulationIds }) => {
                for (const stimulationId of stimulationIds) invalidateStimulationDetail(stimulationId);
            },
        })
        .dendrite({ collateral: explorerActionAxon.retryAccepted, response: () => { void stimulationModel.invalidate(); } })
        .dendrite({ collateral: explorerActionAxon.cloneAccepted, response: () => { void stimulationModel.invalidate(); } })
        .dendrite({ collateral: explorerActionAxon.launchAccepted, response: () => { void stimulationModel.invalidate(); } });
}
