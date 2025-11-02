import { neuron } from '@cnstra/core';
import { appModelAxon } from './AppModelAxon';
import { wsAxon } from '../ws/WsAxon';
import { mainCNS } from '../index';
import { db } from '../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';
import { dbEventQueue } from '../../model';

export const appIngressNeuron = neuron('app-ingress-neuron', appModelAxon).bind(
    wsAxon,
    {
        open: () => {},
        close: () => {},
        error: () => {},
        message: (raw, axon) => {
            try {
                const msg =
                    typeof raw === 'string' ? JSON.parse(raw) : undefined;
                if (!msg) return;
                console.log('🔍 AppIngressNeuron received:', msg.type, {
                    timestamp: new Date().toISOString(),
                    payload:
                        raw.length > 200 ? raw.substring(0, 200) + '...' : raw,
                });
                if (msg.type === 'init') {
                    console.log(
                        '🔗 AppIngressNeuron forwarding init message:',
                        {
                            msgType: msg.type,
                            appId: msg.appId,
                            cnsId: msg.cnsId,
                            neuronsCount: msg.neurons?.length || 0,
                            collateralsCount: msg.collaterals?.length || 0,
                            dendritesCount: msg.dendrites?.length || 0,
                        }
                    );
                    return axon.devtoolsInit.createSignal(msg);
                }
                if (msg.type === 'apps:topology') {
                    console.log(
                        '🔍 AppIngressNeuron received topology:',
                        msg.inits?.length || 0,
                        'inits'
                    );
                    // replay all init messages for late clients
                    if (Array.isArray(msg.inits)) {
                        console.log(
                            '🔄 Replaying',
                            msg.inits.length,
                            'init messages...'
                        );
                        for (const initMsg of msg.inits) {
                            console.log(
                                '🔗 Replaying init for app:',
                                initMsg.appId
                            );
                            // Use setTimeout to avoid blocking the current neuron response
                            setTimeout(() => {
                                mainCNS.stimulate(
                                    axon.devtoolsInit.createSignal(initMsg)
                                );
                            }, 0);
                        }
                        return; // processed all inits
                    }
                }
                if (
                    msg.type === 'neuron-response-batch' ||
                    msg.type === 'response-batch'
                ) {
                    const responses = (msg as any).responses || [];
                    const replayResponses = responses.filter((r: any) => {
                        const stimId = r.stimulationId || '';
                        return (
                            typeof stimId === 'string' &&
                            stimId.includes('-replay-')
                        );
                    });

                    if (replayResponses.length > 0) {
                        console.log(
                            '🔁 [AppIngressNeuron] Got REPLAY response-batch:',
                            {
                                totalResponses: responses.length,
                                replayResponsesCount: replayResponses.length,
                                replayStimIds: replayResponses
                                    .slice(0, 3)
                                    .map((r: any) => r.stimulationId),
                                replayAppIds: replayResponses
                                    .slice(0, 3)
                                    .map((r: any) => r.appId),
                            }
                        );
                    }

                    return axon.devtoolsResponseBatch.createSignal(msg);
                }
                if (msg.type === 'cns:responses') {
                    // Normalize to devtoolsResponseBatch
                    return axon.devtoolsResponseBatch.createSignal({
                        type: 'response-batch',
                        responses: msg.responses || [],
                    });
                }
                if (msg.type === 'stimulation-batch') {
                    console.log(
                        '🔗 AppIngressNeuron forwarding stimulation batch:',
                        {
                            stimulationsCount: msg.stimulations?.length || 0,
                        }
                    );
                    return axon.stimulationBatch.createSignal(msg);
                }
                if (msg.type === 'apps:active') {
                    console.log('📤 AppIngressNeuron sending appsActive:', {
                        apps: msg.apps || [],
                    });
                    return axon.appsActive.createSignal({
                        type: 'apps:active',
                        apps: msg.apps || [],
                    });
                }
                if (msg.type === 'app:added') {
                    console.log('📤 AppIngressNeuron sending appAdded:', {
                        app: msg.app,
                        appId: msg.app?.appId,
                        appName: msg.app?.appName,
                        fullMessage: msg,
                    });
                    return axon.appAdded.createSignal({
                        type: 'app:added',
                        app: msg.app,
                    });
                }
                // apps:replays handled in page-local listener (ignore here)
                if (msg.type === 'apps:cns') {
                    console.log('📡 AppIngressNeuron received apps:cns:', {
                        appId: msg.appId,
                        cns: Array.isArray(msg.cns)
                            ? msg.cns.map((c: any) => c.cnsId)
                            : [],
                    });
                    try {
                        const appId = String(msg.appId || 'unknown-app');
                        const list = Array.isArray(msg.cns) ? msg.cns : [];
                        for (const item of list) {
                            const cnsId = String(item?.cnsId || '');
                            if (!cnsId) continue;
                            db.cns.upsertOne({ cnsId, appId });
                            const idx = db.cns.indexes
                                .appId as OIMReactiveIndexManual<
                                string,
                                string
                            >;
                            idx.addPks(appId, [cnsId]);
                        }
                    } catch (e) {
                        console.error('❌ Failed to persist apps:cns:', e);
                    }
                    return; // handled
                }
                if (msg.type === 'apps:list') {
                    // Normalize to apps:active for existing pipeline
                    console.log(
                        '📤 AppIngressNeuron normalizing apps:list to apps:active:',
                        {
                            apps: msg.apps || [],
                        }
                    );
                    return axon.appsActive.createSignal({
                        type: 'apps:active',
                        apps: msg.apps || [],
                    });
                }
                if (msg.type === 'apps:responses') {
                    // Process historical responses
                    const responses = msg.responses || [];
                    console.log(
                        '📊 AppIngressNeuron received historical responses:',
                        responses.length
                    );

                    for (const response of responses) {
                        try {
                            // Store response in OIMDB
                            db.responses.collection.upsertOne({
                                responseId: response.responseId,
                                stimulationId: response.stimulationId,
                                timestamp: response.timestamp,
                                appId: response.appId,
                                inputCollateralName:
                                    response.inputCollateralName,
                                outputCollateralName:
                                    response.outputCollateralName,
                                hopIndex: response.hopIndex,
                                contexts: response.contexts,
                                inputPayload: response.inputPayload,
                                outputPayload: response.outputPayload,
                                responsePayload: response.responsePayload,
                                error: response.error,
                                duration: response.duration,
                                cnsId: response.cnsId,
                            });
                            db.responses.indexes.appId.addPks(response.appId, [
                                response.responseId,
                            ]);
                            db.responses.indexes.stimulationId.addPks(
                                response.stimulationId,
                                [response.responseId]
                            );
                        } catch (e) {
                            console.error(
                                '❌ Failed to save historical response:',
                                e
                            );
                        }
                    }
                    return;
                }
                if (msg.type === 'server:metrics') {
                    try {
                        db.serverMetrics.collection.upsertOne({
                            timestamp: Number(msg.timestamp) || Date.now(),
                            rssMB: Number(msg.rssMB) || 0,
                            heapUsedMB: Number(msg.heapUsedMB) || 0,
                            heapTotalMB: Number(msg.heapTotalMB) || 0,
                            externalMB: Number(msg.externalMB) || 0,
                            cpuPercent: Number(msg.cpuPercent) || 0,
                        });
                        db.serverMetrics.indexes.all.addPks('all', [
                            `${Number(msg.timestamp) || Date.now()}`,
                        ]);
                    } catch {}
                    return;
                }
                if (msg.type === 'app:disconnected') {
                    return axon.appDisconnected.createSignal({
                        appId: msg.appId as string,
                    });
                }
            } catch (e) {
                console.error('❌ AppIngressNeuron error:', e);
            }
        },
    }
);
