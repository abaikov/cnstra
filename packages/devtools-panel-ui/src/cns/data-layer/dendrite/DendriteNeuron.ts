import { neuron } from '@cnstra/core';
import { db } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';

export const dendriteNeuron = neuron('dendrite-neuron', appModelAxon).bind(
    appModelAxon,
    {
        devtoolsInit: (payload: any) => {
            for (const d of (payload.dendrites as Array<{
                id: string;
                appId: string;
                cnsId: string;
                neuronId: string;
                name: string;
            }>) || []) {
                // Ensure dendrites are present in DB (idempotent upsert)
                db.dendrites.upsertOne({
                    id: d.id,
                    appId: d.appId,
                    cnsId: d.cnsId,
                    neuronId: d.neuronId,
                    name: d.name,
                });
            }
        },
        devtoolsResponseBatch: () => undefined,
        selectAppClicked: () => undefined,
        appsActive: () => undefined,
        appAdded: () => undefined,
        appDisconnected: () => undefined,
        stimulationBatch: () => undefined,
    }
);
