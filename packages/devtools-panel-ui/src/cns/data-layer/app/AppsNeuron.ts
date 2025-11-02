import { neuron } from '@cnstra/core';
import { appModelAxon } from '../../controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';
import {
    AppDisconnectedMessage,
    AppsActiveMessage,
    DevToolsApp,
    InitMessage,
    ResponseBatchMessage,
} from '@cnstra/devtools-dto';

export const appsNeuron = neuron('apps-neuron', appModelAxon)
    .dendrite({
        collateral: appModelAxon.devtoolsInit,
        response: (payload: InitMessage) => {
            console.log('🔍 AppsNeuron received InitMessage:', {
                type: payload.type,
                appId: payload.appId,
                appName: payload.appName,
                neuronsCount: payload.neurons?.length || 0,
                collateralsCount: payload.collaterals?.length || 0,
                dendritesCount: payload.dendrites?.length || 0,
                rawPayload: payload,
            });

            const appId = payload.appId as string;

            // Process app info
            // Note: We don't set firstSeenAt/lastSeenAt here because InitMessage doesn't contain them
            // These fields are managed by the server and come via apps:active messages
            db.apps.upsertOne({
                appId,
                appName: payload.appName,
                version: payload.version,
                firstSeenAt: payload.timestamp, // fallback to message timestamp
                lastSeenAt: payload.timestamp, // fallback to message timestamp
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
                    cnsId: neuron.cnsId,
                    name: neuron.name,
                });
                const neuronIndex = db.neurons.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                neuronIndex.addPks(neuron.appId, [neuron.id]);
            }

            // Process collaterals
            for (const collateral of (payload as any).collaterals || []) {
                db.collaterals.upsertOne({
                    id: collateral.id,
                    name: collateral.name,
                    appId: collateral.appId,
                    cnsId: collateral.cnsId,
                    neuronId: collateral.neuronId,
                });
                const collAppIndex = db.collaterals.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                const collNeuronIndex = db.collaterals.indexes
                    .neuronId as OIMReactiveIndexManual<string, string>;
                collAppIndex.addPks(collateral.appId, [collateral.id]);
                collNeuronIndex.addPks(collateral.neuronId, [collateral.id]);
            }

            // Process dendrites
            for (const dendrite of (payload as any).dendrites || []) {
                db.dendrites.upsertOne({
                    id: dendrite.id,
                    neuronId: dendrite.neuronId,
                    appId: dendrite.appId,
                    cnsId: dendrite.cnsId,
                    name: dendrite.name,
                });
                const dendAppIndex = db.dendrites.indexes
                    .appId as OIMReactiveIndexManual<string, string>;
                const dendNeuronIndex = db.dendrites.indexes
                    .neuronId as OIMReactiveIndexManual<string, string>;
                dendAppIndex.addPks(dendrite.appId, [dendrite.id]);
                dendNeuronIndex.addPks(dendrite.neuronId, [dendrite.id]);
            }

            console.log('🔧 DevTools topology ingested:', {
                appId,
                neurons: payload.neurons.length,
                collaterals: payload.collaterals.length,
                dendrites: payload.dendrites.length,
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
            // Update apps with server-managed timestamps
            console.log('🔄 AppsNeuron received AppsActiveMessage:', {
                appsCount: payload.apps?.length || 0,
                apps: payload.apps,
            });

            if (payload.apps && payload.apps.length > 0) {
                for (const app of payload.apps) {
                    db.apps.upsertOne({
                        appId: app.appId,
                        appName: app.appName,
                        version: app.version,
                        firstSeenAt: app.firstSeenAt,
                        lastSeenAt: app.lastSeenAt,
                    });
                    const allIndex = db.apps.indexes
                        .all as OIMReactiveIndexManual<'all', string>;
                    allIndex.addPks('all', [app.appId]);
                }
                dbEventQueue.flush();

                // Request topology for new apps
                console.log('📡 Requesting topology for newly active apps...');
                // Note: We can't directly send WebSocket messages from here,
                // but the UI should handle this by listening to apps changes
            }
        },
    })
    .dendrite({
        collateral: appModelAxon.appAdded,
        response: (payload: { type: 'app:added'; app: DevToolsApp }) => {
            console.log('🆕 AppsNeuron received AppAdded:', {
                appId: payload.app.appId,
                appName: payload.app.appName,
                fullPayload: payload,
            });

            // Add the new app to the database
            db.apps.upsertOne(payload.app);
            const allIndex = db.apps.indexes.all as OIMReactiveIndexManual<
                'all',
                string
            >;
            allIndex.addPks('all', [payload.app.appId]);
            dbEventQueue.flush();

            // Debug: Check if app was actually added
            setTimeout(() => {
                const allApps = db.apps.getAll();
                const addedApp = allApps.find(
                    app => app.appId === payload.app.appId
                );
                console.log('🔍 DEBUG: App added check:', {
                    requestedAppId: payload.app.appId,
                    foundApp: !!addedApp,
                    totalApps: allApps.length,
                    allAppIds: allApps.map(a => a.appId),
                });
            }, 100);

            // Request topology for the new app
            console.log(
                '📡 Requesting topology for newly added app:',
                payload.app.appId
            );
            // Note: We can't directly send WebSocket messages from here,
            // but the UI should handle this by listening to apps changes
        },
    })
    .dendrite({
        collateral: appModelAxon.appDisconnected,
        response: (payload: AppDisconnectedMessage) => {
            // no-op for now
        },
    });
