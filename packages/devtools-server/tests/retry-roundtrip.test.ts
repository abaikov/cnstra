import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSAppBatchMessageDTO,
} from '@cnstra/devtools-dto';

// Integration test for the RETRY round-trip the Explorer's Retry button drives:
//   panel → server.handleStimulationRetry → (accept the UI) + forward a
//   `cns.stimulation.resume` command to the owning app's socket.
// This is the seam that was untested and let a stale-build protocol drift slip
// through. It runs entirely in-memory (no broker) with fake sockets.

function makeWs(id = 'ws') {
    const sent: string[] = [];
    return {
        _id: id,
        readyState: 1,
        sent,
        send: (data: string) => sent.push(data),
        msgs: () => sent.map(s => JSON.parse(s)),
        ofType: (t: string) => sent.map(s => JSON.parse(s)).find(m => m.type === t),
    };
}

const CNS_ID = 'app:core';
const APP = 'app';

const topology = (): TCNSAppBatchMessageDTO => ({
    type: 'batch',
    items: [
        {
            type: 'topology',
            appId: APP,
            cnsId: CNS_ID,
            appName: 'Test App',
            version: '1.0.0',
            timestamp: 1000,
            neurons: [{ name: 'persistUser', cnsId: CNS_ID, appId: APP }],
            collaterals: [
                { name: 'enriched', ownerNeuronName: 'persistUser', cnsId: CNS_ID, appId: APP },
            ],
            dendrites: [],
        },
    ],
});

const failedStim = (id: string, scopeName: string): TCNSStimulationState => ({
    stimulationId: id,
    entry: { collateralName: 'importUser', payload: { userId: '42' } },
    status: 'failed',
    scopeName,
    // non-empty frontier = resumable
    progress: {
        tasks: [
            {
                neuronName: 'persistUser',
                dendriteCollateralName: 'enriched',
                input: { collateralName: 'enriched', payload: { id: '42' } },
            },
        ],
    },
});
const attempt = (id: string): TCNSStimulationAttempt => ({
    stimulationAttemptId: `${id}#1`,
    stimulationId: id,
    attemptNumber: 1,
    status: 'failed',
    startedAt: 1000,
    completedAt: 1100,
    hopCount: 1,
    hasError: true,
    replayOf: null,
    entry: [{ collateralName: 'importUser', payload: { userId: '42' } }],
});

describe('stimulation retry round-trip (panel → server → app)', () => {
    let store: CNSInMemoryStimulationRepository;
    let server: CNSDevToolsServer;

    beforeEach(() => {
        store = new CNSInMemoryStimulationRepository();
        server = new CNSDevToolsServer(
            new CNSDevToolsServerRepositoryInMemory(),
            store
        );
    });
    afterEach(() => server.stop());

    async function connectApp() {
        const appWs = makeWs('app');
        await server.handleMessage(appWs as any, JSON.stringify(topology()));
        return appWs;
    }

    it('accepts the UI and forwards a well-formed resume command to the app', async () => {
        const appWs = await connectApp();
        await store.saveStimulation(failedStim('s1', CNS_ID));
        await store.saveAttempt(attempt('s1'));

        const ui = makeWs('ui');
        await server.handleMessage(
            ui as any,
            JSON.stringify({
                type: 'stimulation.retry',
                requestId: 'r1',
                stimulationId: 's1',
            })
        );

        // UI is told it was accepted (attempt #2).
        const acc = ui.ofType('stimulation.retry.accepted');
        expect(acc).toBeTruthy();
        expect(acc.stimulationId).toBe('s1');
        expect(acc.newStimulationAttemptId).toBe('s1#2');

        // The app receives a resume command carrying the stored frontier + entry.
        const cmd = appWs.ofType('cns.stimulation.resume');
        expect(cmd).toBeTruthy();
        expect(cmd.stimulationId).toBe('s1');
        expect(cmd.attemptNumber).toBe(2);
        expect(cmd.scopeName).toBe(CNS_ID);
        expect(cmd.entry.collateralName).toBe('importUser');
        expect(cmd.progress.tasks).toHaveLength(1);
        expect(cmd.progress.tasks[0].neuronName).toBe('persistUser');
    });

    it('rejects an unknown stimulation', async () => {
        await connectApp();
        const ui = makeWs('ui');
        await server.handleMessage(
            ui as any,
            JSON.stringify({ type: 'stimulation.retry', requestId: 'r', stimulationId: 'nope' })
        );
        const rej = ui.ofType('stimulation.retry.rejected');
        expect(rej.reason).toMatch(/unknown/i);
    });

    it('rejects a run with an empty frontier (nothing to resume)', async () => {
        await connectApp();
        await store.saveStimulation({
            ...failedStim('s2', CNS_ID),
            progress: { tasks: [] },
        });
        const ui = makeWs('ui');
        await server.handleMessage(
            ui as any,
            JSON.stringify({ type: 'stimulation.retry', requestId: 'r', stimulationId: 's2' })
        );
        expect(ui.ofType('stimulation.retry.rejected').reason).toMatch(/frontier/i);
    });

    it('rejects when the owning app is not connected', async () => {
        // stimulation exists but scope has no registered app socket
        await store.saveStimulation(failedStim('s3', 'ghost:core'));
        const ui = makeWs('ui');
        await server.handleMessage(
            ui as any,
            JSON.stringify({ type: 'stimulation.retry', requestId: 'r', stimulationId: 's3' })
        );
        expect(ui.ofType('stimulation.retry.rejected').reason).toMatch(/no runtime accepted/i);
    });
});
