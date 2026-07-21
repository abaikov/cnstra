/**
 * E2E late-joining flow: panel connects, receives an initial apps list, then a
 * new app connects with its topology. Drives the real pipeline end-to-end
 * (ws message → AppIngressNeuron → data-layer → OIMDB).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db, dbEventQueue } from '../model';
import type {
    CNSDTOApp,
    CNSDTONeuron,
    CNSDTOServerMessage,
} from '@cnstra/devtools-dto';
import { mainCNS } from '../cns';
import { wsAxon } from '../cns/ws/WsAxon';

// Deterministic: await the whole ingest → data-layer chain, then flush the queue.
const feed = async (msg: CNSDTOServerMessage) => {
    await mainCNS
        .stimulate(wsAxon.message.createSignal(JSON.stringify(msg)))
        .waitUntilComplete();
    dbEventQueue.flush();
};

const makeApp = (id: string, name: string): CNSDTOApp => ({
    id,
    name,
    version: '1.0.0',
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
});

const makeNeuron = (appId: string, name: string): CNSDTONeuron => ({
    id: `${appId}:main:${name}`,
    name,
    cnsId: `${appId}:main`,
    appId,
});

const clearDatabase = () => {
    db.apps.clear();
    db.neurons.clear();
    db.collaterals.clear();
    db.dendrites.clear();
    db.cns.clear();
    db.stimulations.clear();
    db.responses.clear();
    dbEventQueue.flush();
};

describe('E2E Late-Joining Apps', () => {
    beforeEach(() => clearDatabase());

    it('runs the full connect → list → late-join flow', async () => {
        // Step 1: initial apps list (server's response to the connect).
        await feed({
            type: 'apps.result',
            requestId: '__init__',
            items: [makeApp('existing-app', 'Existing App')],
        });
        expect(db.apps.getAll().map(a => a.id)).toEqual(['existing-app']);

        // Step 2: a new app connects with a topology.
        await feed({
            type: 'app.connected',
            app: makeApp('late-app', 'Late App'),
            topology: {
                cnsId: 'late-app:main',
                neurons: [makeNeuron('late-app', 'api')],
                collaterals: [
                    {
                        id: 'late-app:main:api:done',
                        name: 'done',
                        neuronId: 'late-app:main:api',
                        cnsId: 'late-app:main',
                        appId: 'late-app',
                    },
                ],
                dendrites: [],
            },
        });

        // Both apps present, and the late app's topology landed.
        expect(db.apps.getAll().map(a => a.id).sort()).toEqual([
            'existing-app',
            'late-app',
        ]);
        expect(
            Array.from(db.neurons.indexes.appId.getPksByKey('late-app'))
        ).toEqual(['late-app:main:api']);
        expect(db.collaterals.getAll().length).toBe(1);
        expect(db.cns.getOneByPk('late-app:main')?.appId).toBe('late-app');
    });
});
