/**
 * WebSocket → CNS → OIMDB integration. Feeds raw `CNSDTOServerMessage`s through
 * the real ingress (no mocks) and asserts the resulting OIMDB state.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db, dbEventQueue } from '../../model';
import type {
    CNSDTOHop,
    CNSDTOServerMessage,
    CNSDTOStimulation,
} from '@cnstra/devtools-dto';
import { mainCNS } from '../../cns';
import { wsAxon } from '../../cns/ws/WsAxon';

// Deterministic: await the whole ingest → data-layer chain, then flush the queue.
const feed = async (msg: CNSDTOServerMessage) => {
    await mainCNS
        .stimulate(wsAxon.message.createSignal(JSON.stringify(msg)))
        .waitUntilComplete();
    dbEventQueue.flush();
};

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

const APP = 'test-app';
const CNS_ID = 'test-app:main';

const connectMsg = (): CNSDTOServerMessage => ({
    type: 'app.connected',
    app: {
        id: APP,
        name: 'Test Application',
        version: '1.0.0',
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
    },
    topology: {
        cnsId: CNS_ID,
        neurons: [
            { id: `${CNS_ID}:api`, name: 'api', cnsId: CNS_ID, appId: APP },
            { id: `${CNS_ID}:worker`, name: 'worker', cnsId: CNS_ID, appId: APP },
        ],
        collaterals: [
            {
                id: `${CNS_ID}:api:request`,
                name: 'request',
                neuronId: `${CNS_ID}:api`,
                cnsId: CNS_ID,
                appId: APP,
            },
            {
                id: `${CNS_ID}:worker:done`,
                name: 'done',
                neuronId: `${CNS_ID}:worker`,
                cnsId: CNS_ID,
                appId: APP,
            },
        ],
        dendrites: [
            {
                id: `${CNS_ID}:worker:d:request`,
                neuronId: `${CNS_ID}:worker`,
                collateralId: `${CNS_ID}:api:request`,
                cnsId: CNS_ID,
                appId: APP,
            },
        ],
    },
});

describe('WebSocket → CNS → OIMDB Integration', () => {
    beforeEach(() => clearDatabase());

    it('stores an app.connected topology in OIMDB', async () => {
        await feed(connectMsg());

        expect(db.apps.getOneByPk(APP)?.name).toBe('Test Application');
        expect(db.cns.getOneByPk(CNS_ID)?.appId).toBe(APP);

        const neurons = db.neurons.getAll();
        expect(neurons.map(n => n.name).sort()).toEqual(['api', 'worker']);

        const collaterals = db.collaterals.getAll();
        expect(collaterals.find(c => c.name === 'request')?.neuronId).toBe(
            `${CNS_ID}:api`
        );

        const dendrites = db.dendrites.getAll();
        expect(dendrites.length).toBe(1);
        expect(dendrites[0].collateralId).toBe(`${CNS_ID}:api:request`);

        // Derived indexes are maintained automatically.
        expect(
            db.neurons.indexes.appId.getPksByKey(APP).size
        ).toBe(2);
    });

    it('stores a stimulation and its hops, indexed by stimulation and app', async () => {
        await feed(connectMsg());

        const stimulation: CNSDTOStimulation = {
            id: 'stim-1',
            cnsId: CNS_ID,
            appId: APP,
            collateralId: `${CNS_ID}:api:request`,
            payload: { n: 1 },
            startedAt: Date.now(),
            completedAt: null,
            hopCount: 0,
            hasError: false,
            replayOf: null,
        };
        await feed({ type: 'stimulation.started', stimulation });

        const hop = (index: number): CNSDTOHop => ({
            id: `stim-1:${index}`,
            stimulationId: 'stim-1',
            index,
            neuronId: `${CNS_ID}:worker`,
            inputCollateralId: `${CNS_ID}:api:request`,
            outputCollateralId: `${CNS_ID}:worker:done`,
            inputPayload: { n: 1 },
            outputPayload: { ok: true },
            startedAt: Date.now(),
            duration: 2,
            error: null,
        });
        await feed({ type: 'stimulation.hop', hop: hop(0) });
        await feed({ type: 'stimulation.hop', hop: hop(1) });

        // Stimulation stored.
        expect(db.stimulations.getOneByPk('stim-1')?.appId).toBe(APP);

        // Hops stored, with appId denormalized from the parent stimulation.
        const hops = db.responses.getAll();
        expect(hops.length).toBe(2);
        expect(hops.every(h => h.appId === APP)).toBe(true);

        // Indexed by stimulation and by app.
        expect(
            db.responses.indexes.stimulationId.getPksByKey('stim-1').size
        ).toBe(2);
        expect(db.responses.indexes.appId.getPksByKey(APP).size).toBe(2);

        // Completion patch applies.
        await feed({
            type: 'stimulation.completed',
            stimulationId: 'stim-1',
            completedAt: Date.now(),
            hopCount: 2,
            hasError: false,
        });
        const done = db.stimulations.getOneByPk('stim-1');
        expect(done?.completedAt).not.toBeNull();
        expect(done?.hopCount).toBe(2);
    });
});
