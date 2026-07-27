import { neuron } from '@cnstra/core';
import type { CNSDTOServerMessage } from '@cnstra/devtools-dto';
import { appModelAxon } from './AppModelAxon';
import { wsAxon } from '../ws/WsAxon';

/**
 * Parses the raw WebSocket stream (the server's `CNSDTOServerMessage` protocol)
 * into domain events on `appModelAxon`. It does not touch the database — the
 * data-layer neurons persist the events it emits.
 *
 * Stimulation/hop data no longer flows through here: it is polled by
 * `createDurableIngest` (name-based `cns.stimulations.query`) and translated into
 * the same `stimulationStarted`/`hopAdded`/`stimulationCompleted` domain events.
 * This ingress now only handles topology, app lifecycle, and server metrics.
 */
export const appIngressNeuron = neuron(appModelAxon).bind(wsAxon, {
    open: () => {},
    close: () => {},
    error: () => {},
    message: (raw, axon) => {
        let msg: CNSDTOServerMessage | undefined;
        try {
            msg = typeof raw === 'string' ? JSON.parse(raw) : undefined;
        } catch {
            return;
        }
        if (!msg || typeof (msg as { type?: unknown }).type !== 'string') {
            return;
        }

        switch (msg.type) {
            case 'app.connected':
                return [
                    axon.appUpserted.createSignal(msg.app),
                    axon.topologyReceived.createSignal({
                        cnsId: msg.topology.cnsId,
                        appId: msg.app.id,
                        neurons: msg.topology.neurons,
                        collaterals: msg.topology.collaterals,
                        dendrites: msg.topology.dendrites,
                    }),
                ];

            case 'app.disconnected':
                return axon.appDisconnected.createSignal({ appId: msg.appId });

            case 'topology':
                return axon.topologyReceived.createSignal({
                    cnsId: msg.cnsId,
                    appId: msg.appId,
                    neurons: msg.neurons,
                    collaterals: msg.collaterals,
                    dendrites: msg.dendrites,
                });

            case 'server.metrics':
                return axon.serverMetrics.createSignal({
                    timestamp: msg.timestamp,
                    rssMB: msg.rssMB,
                    heapUsedMB: msg.heapUsedMB,
                    heapTotalMB: msg.heapTotalMB,
                    cpuPercent: msg.cpuPercent,
                });

            case 'apps.result':
                return msg.items.map(app => axon.appUpserted.createSignal(app));

            case 'topology.result':
                return msg.snapshots.map(s =>
                    axon.topologyReceived.createSignal({
                        cnsId: s.cnsId,
                        appId: s.appId,
                        neurons: s.neurons,
                        collaterals: s.collaterals,
                        dendrites: s.dendrites,
                    })
                );

            // replay.accepted / replay.rejected are handled by page-local listeners.
            default:
                return;
        }
    },
});
