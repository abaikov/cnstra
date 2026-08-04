/**
 * WebSocket → CNS → OIMDB integration. Feeds raw `TCNSServerMessageDTO`s through
 * the real ingress (no mocks) and asserts the resulting OIMDB state.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { db, dbEventQueue } from '../../model';
import type { TCNSServerMessageDTO } from '@cnstra/devtools-dto';
import { mainCNS } from '../../cns';
import { wsAxon } from '../../cns/ws/WsAxon';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { projectView } from '../../app/controllers/durableIngest';
import type { TCNSStimulationViewDTO } from '@cnstra/devtools-dto';

// Deterministic: await the whole ingest → data-layer chain, then flush the queue.
const feed = async (msg: TCNSServerMessageDTO) => {
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

const connectMsg = (): TCNSServerMessageDTO => ({
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
            { name: 'api', cnsId: CNS_ID, appId: APP },
            { name: 'worker', cnsId: CNS_ID, appId: APP },
        ],
        collaterals: [
            { name: 'request', ownerNeuronName: 'api', cnsId: CNS_ID, appId: APP },
            { name: 'done', ownerNeuronName: 'worker', cnsId: CNS_ID, appId: APP },
        ],
        dendrites: [
            { neuronName: 'worker', collateralName: 'request', cnsId: CNS_ID, appId: APP },
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
        expect(collaterals.find(c => c.name === 'request')?.ownerNeuronName).toBe(
            'api'
        );

        const dendrites = db.dendrites.getAll();
        expect(dendrites.length).toBe(1);
        expect(dendrites[0].collateralName).toBe('request');

        // Derived indexes are maintained automatically.
        expect(
            db.neurons.indexes.appId.getPksByKey(APP).size
        ).toBe(2);
    });

    it('stores a name-based stimulation view as a header + flat name-based hops in OIMDB', async () => {
        await feed(connectMsg());

        // A name-based run view (the shape polled via `cns.stimulations.query`),
        // scoped to this cns, with one completed attempt of two tasks.
        const view: TCNSStimulationViewDTO = {
            stimulationId: 'stim-1',
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

        // The ingest's projection step: the name-based view → the panel's stored
        // header + flat name-based hops. NO id is synthesized from names.
        const { stimulation, hops } = projectView(view, CNS_ID, APP);

        // Header is name-based (entry stays a collateral NAME, not a topology id).
        expect(stimulation.stimulationId).toBe('stim-1');
        expect(stimulation.scopeName).toBe(CNS_ID);
        expect(stimulation.appId).toBe(APP);
        expect(stimulation.entry.collateralName).toBe('request');

        // Hops carry neuron & collateral NAMES; id is a surrogate row key.
        expect(hops.map(h => h.neuronName)).toEqual(['api', 'worker']);
        expect(hops[0].dendriteCollateralName).toBe('request');
        expect(hops[1].output?.collateralName).toBe('done');
        expect(hops.map(h => h.id)).toEqual(['stim-1#1:0', 'stim-1#1:1']);

        // Feed them through the same data-layer the ingest uses.
        mainCNS.stimulate(appModelAxon.stimulationStarted.createSignal(stimulation));
        for (const hop of hops) {
            mainCNS.stimulate(appModelAxon.hopAdded.createSignal(hop));
        }
        mainCNS.stimulate(
            appModelAxon.stimulationCompleted.createSignal({
                stimulationId: stimulation.stimulationId,
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
