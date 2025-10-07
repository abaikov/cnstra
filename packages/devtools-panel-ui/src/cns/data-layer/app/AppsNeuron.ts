import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';
import {
    AppDisconnectedMessage,
    AppsActiveMessage,
    InitMessage,
    ResponseBatchMessage,
} from '@cnstra/devtools-dto';

export const appsNeuron = neuron('apps-neuron', appModelAxon)
    .dendrite({
        collateral: appModelAxon.devtoolsInit,
        response: (payload: InitMessage) => {
            console.log('🔍 AppsNeuron received InitMessage:', {
                type: payload.type,
                appId: (payload as any).appId,
                appName: payload.appName,
                neuronsCount: payload.neurons?.length || 0,
                collateralsCount: payload.collaterals?.length || 0,
                dendritesCount: payload.dendrites?.length || 0,
                rawPayload: payload,
            });

            const appId = (payload as any).appId as string;

            // Process app info
            db.apps.upsertOne({
                appId,
                appName: payload.appName,
                version: payload.version,
                firstSeenAt: payload.timestamp,
                lastSeenAt: payload.timestamp,
            });
            const allIndex = db.apps.indexes.all as OIMReactiveIndexManual<
                'all',
                string
            >;
            allIndex.addPks('all', [appId]);

            // Process neurons
            for (const neuron of payload.neurons) {
                db.neurons.upsertOne({
                    id: neuron.id,
                    appId: neuron.appId,
                    name: neuron.name,
                });
                const neuronIndex = db.neurons.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                neuronIndex.addPks(neuron.appId, [neuron.id]);
            }

            // Process collaterals
            for (const collateral of (payload as any).collaterals || []) {
                db.collaterals.upsertOne({
                    collateralName: collateral.collateralName,
                    name: collateral.collateralName,
                    appId: collateral.appId,
                    neuronId: collateral.neuronId,
                    type: collateral.type,
                } as any);
                const collAppIndex = db.collaterals.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                const collNeuronIndex = db.collaterals.indexes
                    .neuronId as OIMReactiveIndexManual<string, string>;
                collAppIndex.addPks(collateral.appId, [
                    collateral.collateralName,
                ]);
                collNeuronIndex.addPks(collateral.neuronId, [
                    collateral.collateralName,
                ]);
            }

            // Process dendrites
            for (const dendrite of (payload as any).dendrites || []) {
                db.dendrites.upsertOne({
                    dendriteId: dendrite.dendriteId,
                    neuronId: dendrite.neuronId,
                    appId: dendrite.appId,
                    collateralName: dendrite.collateralName,
                    type: dendrite.type,
                } as any);
                const dendAppIndex = db.dendrites.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                const dendNeuronIndex = db.dendrites.indexes
                    .neuronId as OIMReactiveIndexManual<string, string>;
                dendAppIndex.addPks(dendrite.appId, [dendrite.dendriteId]);
                dendNeuronIndex.addPks(dendrite.neuronId, [
                    dendrite.dendriteId,
                ]);
            }

            console.log('🔧 DevTools topology ingested:', {
                appId,
                neurons: payload.neurons.length,
                collaterals: (payload as any).collaterals.length,
                dendrites: (payload as any).dendrites.length,
            });

            // Verify data was stored
            setTimeout(() => {
                const storedNeurons = db.neurons.getAll();
                const storedCollaterals = db.collaterals.getAll();
                const storedDendrites = db.dendrites.getAll();
                console.log('🔍 Verification - Data stored in DB:', {
                    storedNeurons: storedNeurons.length,
                    storedCollaterals: storedCollaterals.length,
                    storedDendrites: storedDendrites.length,
                    firstStoredNeuron: storedNeurons[0],
                    firstStoredCollateral: storedCollaterals[0],
                    firstStoredDendrite: storedDendrites[0],
                });
            }, 100);

            dbEventQueue.flush();
        },
    })
    .dendrite({
        collateral: appModelAxon.devtoolsResponseBatch,
        response: (_payload: ResponseBatchMessage) => {},
    })
    .dendrite({
        collateral: appModelAxon.appsActive,
        response: (payload: AppsActiveMessage) => {
            // no-op: app list handled elsewhere
        },
    })
    .dendrite({
        collateral: appModelAxon.appDisconnected,
        response: (payload: AppDisconnectedMessage) => {
            // no-op for now
        },
    });
