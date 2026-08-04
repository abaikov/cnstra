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
import { ingestSnapshot } from '../../app/controllers/stimulationIngest';
import type {
    TCNSStimulationRowDTO,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/devtools-dto';

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

    it('joins the flat stimulation snapshot buckets into a header + hops in OIMDB', async () => {
        await feed(connectMsg());

        // The flat buckets polled via `cns.stimulations.snapshot`, scoped to this
        // cns: one run + one completed attempt + two tasks — joined client-side by id.
        const stimulations: TCNSStimulationRowDTO[] = [
            {
                stimulationId: 'stim-1',
                scopeName: CNS_ID,
                entry: { collateralName: 'request', payload: { n: 1 } },
                status: 'completed',
                startedAt: Date.now() - 100,
                completedAt: Date.now(),
                hopCount: 2,
                hasError: false,
            },
        ];
        const attempts: TCNSStimulationAttempt[] = [
            {
                stimulationAttemptId: 'stim-1#1',
                stimulationId: 'stim-1',
                attemptNumber: 1,
                status: 'completed',
                startedAt: Date.now() - 100,
                completedAt: Date.now(),
                hopCount: 2,
                hasError: false,
                replayOf: null,
                entry: [{ collateralName: 'request', payload: { n: 1 } }],
            },
        ];
        const tasks: TCNSStimulationTask[] = [
            {
                stimulationAttemptId: 'stim-1#1',
                index: 0,
                neuronName: 'api',
                dendriteCollateralName: 'request',
                inputIndex: 0,
                output: { collateralName: 'request', payload: { n: 1 } },
                status: 'done',
                error: null,
                startedAt: Date.now() - 100,
                duration: 1,
            },
            {
                stimulationAttemptId: 'stim-1#1',
                index: 1,
                neuronName: 'worker',
                dendriteCollateralName: 'request',
                inputIndex: 0,
                output: { collateralName: 'done', payload: { ok: true } },
                status: 'done',
                error: null,
                startedAt: Date.now() - 50,
                duration: 2,
            },
        ];

        ingestSnapshot({ stimulations, attempts, tasks });
        dbEventQueue.flush();

        const stimulation = db.stimulations.getOneByPk('stim-1');
        expect(stimulation?.scopeName).toBe(CNS_ID);
        expect(stimulation?.appId).toBe(APP);
        expect(stimulation?.entry.collateralName).toBe('request');
        // Hops carry neuron & collateral NAMES; id is a surrogate row key.
        const storedHops = db.responses.getAll();
        expect(storedHops.map(h => h.neuronName).sort()).toEqual(['api', 'worker']);
        expect(storedHops.map(h => h.id).sort()).toEqual([
            'stim-1#1:0',
            'stim-1#1:1',
        ]);

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
