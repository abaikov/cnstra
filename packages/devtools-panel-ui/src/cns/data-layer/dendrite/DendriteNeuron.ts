import { neuron } from '@cnstra/core';
import { db } from '../../../model';
import { appModelAxon } from '../../controller-layer/AppModelAxon';

export const dendriteNeuron = neuron('dendrite-neuron', appModelAxon).bind(
    appModelAxon,
    {
        devtoolsInit: (payload: any) => {
            const appId = (payload as any).appId as string;
            for (const d of (payload.dendrites as Array<{
                dendriteId: string;
                appId: string;
                neuronId: string;
                collateralName: string;
                type: string;
                collateralNames: string[];
            }>) || []) {
                // Ensure dendrites are present in DB (idempotent upsert)
                db.dendrites.upsertOne({
                    dendriteId: d.dendriteId,
                    appId: d.appId,
                    neuronId: d.neuronId,
                    collateralName: d.collateralName,
                    type: d.type,
                } as any);
            }
        },
        devtoolsResponseBatch: () => undefined,
        selectAppClicked: () => undefined,
        appsActive: () => undefined,
        appDisconnected: () => undefined,
        stimulationBatch: () => undefined,
    }
);
