import { neuron } from '@cnstra/core';
import { db } from '../../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';

export const stimulationNeuron = neuron('stimulation-neuron', {}).bind(
    appModelAxon,
    {
        devtoolsInit: () => {},
        devtoolsResponseBatch: () => {},
        selectAppClicked: () => {},
        appsActive: () => {},
        appDisconnected: () => {},
        stimulationBatch: (payload, axon) => {
            const message = payload as {
                type: 'stimulation-batch';
                stimulations: Array<{
                    type: 'stimulation';
                    appId: string;
                    stimulationId: string;
                    timestamp: number;
                    neuronId: string;
                    collateralName: string;
                    payload?: unknown;
                    queueLength: number;
                    hops?: number;
                    error?: unknown;
                }>;
            };
            console.log('StimulationNeuron processing batch:', {
                stimulationsCount: message.stimulations.length,
            });

            for (const stimulation of message.stimulations) {
                // Store stimulation in database
                db.stimulations.upsertOne({
                    stimulationId: stimulation.stimulationId,
                    appId: stimulation.appId,
                    timestamp: stimulation.timestamp,
                    neuronId: stimulation.neuronId,
                    collateralName: stimulation.collateralName,
                });

                // Update indexes
                const stimulationAppIndex = db.stimulations.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                stimulationAppIndex.addPks(stimulation.appId, [
                    stimulation.stimulationId,
                ]);
            }
        },
    }
);
