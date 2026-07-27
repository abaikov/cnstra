/**
 * WebSocket → CNS → OIMDB integration. Feeds raw `CNSDTOServerMessage`s through
 * the real ingress (no mocks) and asserts the resulting OIMDB state.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db, dbEventQueue } from '../../model';
import type { CNSDTOServerMessage } from '@cnstra/devtools-dto';
import { mainCNS } from '../../cns';
import { wsAxon } from '../../cns/ws/WsAxon';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { translateRunView } from '../../durable/translateRunView';
import type { TCNSDurableRunView } from '../../durable/TCNSDurableRunView';

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

    it('translates a name-based run view into stimulation + hops in OIMDB (2b-4 ingest)', async () => {
        await feed(connectMsg());

        // A name-based run view (the shape polled via `cns.stimulations.query`),
        // scoped to this cns, with one completed attempt of two tasks.
        const run: TCNSDurableRunView = {
            runId: 'stim-1',
            status: 'completed',
            scopeName: CNS_ID,
            entry: { collateralName: 'request', payload: { n: 1 } },
            frontier: [],
            attempts: [
                {
                    attemptNumber: 1,
                    status: 'completed',
                    hopCount: 2,
                    startedAt: Date.now() - 100,
                    completedAt: Date.now(),
                    tasks: [
                        {
                            index: 0,
                            neuronName: 'api',
                            dendriteCollateralName: 'request',
                            status: 'done',
                            output: { collateralName: 'request', payload: { n: 1 } },
                            error: null,
                            startedAt: Date.now() - 100,
                            duration: 1,
                        },
                        {
                            index: 1,
                            neuronName: 'worker',
                            dendriteCollateralName: 'request',
                            status: 'done',
                            output: { collateralName: 'done', payload: { ok: true } },
                            error: null,
                            startedAt: Date.now() - 50,
                            duration: 2,
                        },
                    ],
                },
            ],
        };

        // The ingest's translation step: name → the panel's id-shaped entities.
        const collateralIdByName = new Map(
            db.collaterals.getAll().filter(c => c.cnsId === CNS_ID).map(c => [c.name, c.id])
        );
        const { stimulation, hops } = translateRunView(run, {
            cnsId: CNS_ID,
            appId: APP,
            collateralIdByName: name => collateralIdByName.get(name),
        });

        // ids reconstruct against the topology exactly.
        expect(stimulation.id).toBe('stim-1');
        expect(stimulation.collateralId).toBe(`${CNS_ID}:api:request`);
        expect(hops.map(h => h.neuronId)).toEqual([
            `${CNS_ID}:api`,
            `${CNS_ID}:worker`,
        ]);
        expect(hops[1].outputCollateralId).toBe(`${CNS_ID}:worker:done`);

        // Feed them through the same data-layer the ingest uses.
        mainCNS.stimulate(appModelAxon.stimulationStarted.createSignal(stimulation));
        for (const hop of hops) {
            mainCNS.stimulate(appModelAxon.hopAdded.createSignal(hop));
        }
        mainCNS.stimulate(
            appModelAxon.stimulationCompleted.createSignal({
                stimulationId: stimulation.id,
                completedAt: stimulation.completedAt!,
                hopCount: stimulation.hopCount,
                hasError: stimulation.hasError,
            })
        );
        dbEventQueue.flush();

        // Stimulation + hops stored, indexed by stimulation and app.
        expect(db.stimulations.getOneByPk('stim-1')?.appId).toBe(APP);
        const stored = db.responses.getAll();
        expect(stored.length).toBe(2);
        expect(stored.every(h => h.appId === APP)).toBe(true);
        expect(
            db.responses.indexes.stimulationId.getPksByKey('stim-1').size
        ).toBe(2);
        expect(db.responses.indexes.appId.getPksByKey(APP).size).toBe(2);

        const done = db.stimulations.getOneByPk('stim-1');
        expect(done?.completedAt).not.toBeNull();
        expect(done?.hopCount).toBe(2);
    });
});
