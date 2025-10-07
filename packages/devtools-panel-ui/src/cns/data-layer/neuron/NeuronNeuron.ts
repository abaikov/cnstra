import { neuron } from '@cnstra/core';
import { db } from '../../../model';
import type { UINeuron } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import {
    ResponseBatchMessage,
    StimulationBatchMessage,
} from '@cnstra/devtools-dto';

export const neuronNeuron = neuron('neuron-neuron', {}).bind(appModelAxon, {
    devtoolsResponseBatch: (payload, axon) => {
        const p = payload as ResponseBatchMessage;
        p.responses.forEach(response => {
            const n = db.neurons.collection.getOneByPk(response.neuronId) as
                | UINeuron
                | undefined;
            if (!n) return;
            const current = n.stimulationCount || 0;
            db.neurons.upsertOne({
                ...n,
                stimulationCount: Math.max(0, current + 1),
            });
        });
    },
    selectAppClicked: () => {},
    appsActive: () => {},
    appDisconnected: () => {},
    stimulationBatch: (payload, axon) => {
        const p = payload as StimulationBatchMessage;
        p.stimulations.forEach(stimulation => {
            const n = db.neurons.collection.getOneByPk(stimulation.neuronId) as
                | UINeuron
                | undefined;
            if (!n) return;
            const current = n.stimulationCount || 0;
            db.neurons.upsertOne({
                ...n,
                stimulationCount: Math.max(0, current + 1),
            });
        });
    },
    // Central ingestion is handled in apps-neuron to avoid duplicates
    // Keep this as a no-op
    devtoolsInit: () => {},
});
