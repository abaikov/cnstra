import { neuron } from '@cnstra/core';
import { appModelAxon } from './AppModelAxon';
import { wsAxon } from '../ws/WsAxon';
import { mainCNS } from '../index';
import { db } from '../../model';
import { OIMReactiveIndexManual } from '@oimdb/core';

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
                console.log('🔍 AppIngressNeuron received:', msg.type);
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
                    return appModelAxon.devtoolsInit.createSignal(msg);
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
                                    appModelAxon.devtoolsInit.createSignal(
                                        initMsg
                                    )
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
                    return appModelAxon.devtoolsResponseBatch.createSignal(msg);
                }
                if (msg.type === 'cns:responses') {
                    // Normalize to devtoolsResponseBatch
                    return appModelAxon.devtoolsResponseBatch.createSignal({
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
                    return appModelAxon.stimulationBatch.createSignal(msg);
                }
                if (msg.type === 'apps:active') {
                    console.log('📤 AppIngressNeuron sending appsActive:', {
                        apps: msg.apps || [],
                    });
                    return appModelAxon.appsActive.createSignal({
                        type: 'apps:active',
                        apps: msg.apps || [],
                    });
                }
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
                    return appModelAxon.appsActive.createSignal({
                        type: 'apps:active',
                        apps: msg.apps || [],
                    });
                }
                if (msg.type === 'cns:neurons') {
                    const init = {
                        type: 'init',
                        appId: msg.appId || 'unknown',
                        cnsId: msg.cnsId,
                        appName: 'unknown',
                        timestamp: Date.now(),
                        neurons: msg.neurons || [],
                        collaterals: [],
                        dendrites: [],
                    } as any;
                    return appModelAxon.devtoolsInit.createSignal(init);
                }
                if (msg.type === 'cns:collaterals') {
                    const init = {
                        type: 'init',
                        appId: msg.appId || 'unknown',
                        cnsId: msg.cnsId,
                        appName: 'unknown',
                        timestamp: Date.now(),
                        neurons: [],
                        collaterals: msg.collaterals || [],
                        dendrites: [],
                    } as any;
                    return appModelAxon.devtoolsInit.createSignal(init);
                }
                if (msg.type === 'cns:dendrites') {
                    const init = {
                        type: 'init',
                        appId: msg.appId || 'unknown',
                        cnsId: msg.cnsId,
                        appName: 'unknown',
                        timestamp: Date.now(),
                        neurons: [],
                        collaterals: [],
                        dendrites: msg.dendrites || [],
                    } as any;
                    return appModelAxon.devtoolsInit.createSignal(init);
                }
                if (msg.type === 'app:disconnected') {
                    return appModelAxon.appDisconnected.createSignal({
                        type: 'app:disconnected',
                        appId: msg.appId as string,
                    });
                }
            } catch (e) {
                console.error('❌ AppIngressNeuron error:', e);
            }
        },
    }
);
