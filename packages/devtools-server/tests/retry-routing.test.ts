import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSAppBatchMessageDTO,
} from '@cnstra/devtools-dto';

// Two ways the Retry button lied to the user:
//
//  1. ROUTING. An app socket is registered in `appSockets` AND in the per-app
//     routing set, but only the first was cleaned up on disconnect. After an app
//     restart the server still believed the (closed) socket was reachable, so
//     retry/clone answered `accepted` and then wrote the command into a dead
//     socket inside a swallowing `try {} catch {}`. Nothing ever ran, and the
//     set grew by one corpse per reconnect.
//
//  2. NUMBERING. The next attempt number came from `attempts.length + 1` — an
//     ordinal, not a maximum. Once retention prunes an old attempt the count no
//     longer tracks the highest number, and the server mints an id that already
//     exists (UNIQUE (stimulation_id, attempt_number)).

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

const attempt = (
    id: string,
    attemptNumber: number
): TCNSStimulationAttempt => ({
    stimulationAttemptId: `${id}#${attemptNumber}`,
    stimulationId: id,
    attemptNumber,
    status: 'failed',
    startedAt: 1000 + attemptNumber,
    completedAt: 1100 + attemptNumber,
    hopCount: 1,
    hasError: true,
    replayOf: null,
    entry: [{ collateralName: 'importUser', payload: { userId: '42' } }],
});

describe('retry routing + attempt numbering', () => {
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

    async function connectApp(id = 'app') {
        const appWs = makeWs(id);
        await server.handleMessage(appWs as any, JSON.stringify(topology()));
        return appWs;
    }

    async function retry(ui: ReturnType<typeof makeWs>, stimulationId: string) {
        await server.handleMessage(
            ui as any,
            JSON.stringify({
                type: 'stimulation.retry',
                requestId: 'r1',
                stimulationId,
            })
        );
    }

    it('rejects a retry after the owning app disconnected', async () => {
        const appWs = await connectApp();
        await store.saveStimulation(failedStim('s1', CNS_ID));
        await store.saveAttempt(attempt('s1', 1));

        // The app goes away (process restart): the transport dispatches `close`.
        server.removeClient(appWs as any);

        const ui = makeWs('ui');
        await retry(ui, 's1');

        expect(ui.ofType('stimulation.retry.accepted')).toBeUndefined();
        expect(ui.ofType('stimulation.retry.rejected')?.reason).toMatch(
            /no runtime accepted/i
        );
        // …and nothing was written into the dead socket.
        expect(appWs.ofType('cns.stimulation.resume')).toBeUndefined();
    });

    it('rejects a retry when the app socket is closed but not yet unregistered', async () => {
        const appWs = await connectApp();
        await store.saveStimulation(failedStim('s1', CNS_ID));
        await store.saveAttempt(attempt('s1', 1));

        // Half-dead socket: `close` has not been dispatched yet, so the routing
        // set still holds it. Registration is not proof of reachability.
        appWs.readyState = 3; // CLOSED

        const ui = makeWs('ui');
        await retry(ui, 's1');

        expect(ui.ofType('stimulation.retry.accepted')).toBeUndefined();
        expect(ui.ofType('stimulation.retry.rejected')?.reason).toMatch(
            /no runtime accepted/i
        );
    });

    it('routes again once the app reconnects on a fresh socket', async () => {
        const first = await connectApp('app-old');
        server.removeClient(first as any);
        const second = await connectApp('app-new');

        await store.saveStimulation(failedStim('s1', CNS_ID));
        await store.saveAttempt(attempt('s1', 1));

        const ui = makeWs('ui');
        await retry(ui, 's1');

        expect(ui.ofType('stimulation.retry.accepted')).toBeTruthy();
        expect(second.ofType('cns.stimulation.resume')).toBeTruthy();
        // The corpse is gone, so it received nothing.
        expect(first.ofType('cns.stimulation.resume')).toBeUndefined();
    });

    it('rejects a clone after the owning app disconnected', async () => {
        const appWs = await connectApp();
        await store.saveStimulation(failedStim('s1', CNS_ID));
        server.removeClient(appWs as any);

        const ui = makeWs('ui');
        await server.handleMessage(
            ui as any,
            JSON.stringify({
                type: 'stimulation.clone',
                requestId: 'c1',
                stimulationId: 's1',
            })
        );

        expect(ui.ofType('stimulation.clone.accepted')).toBeUndefined();
        expect(ui.ofType('stimulation.clone.rejected')?.reason).toMatch(
            /no runtime accepted/i
        );
    });

    it('numbers the next attempt from the highest attempt, not the count', async () => {
        const appWs = await connectApp();
        await store.saveStimulation(failedStim('s1', CNS_ID));
        // Attempt 2 was pruned by retention: 1 and 3 survive, so a count-based
        // formula would re-mint the id of the attempt that is still there.
        await store.saveAttempt(attempt('s1', 1));
        await store.saveAttempt(attempt('s1', 3));

        const ui = makeWs('ui');
        await retry(ui, 's1');

        const acc = ui.ofType('stimulation.retry.accepted');
        expect(acc.newStimulationAttemptId).toBe('s1#4');

        const cmd = appWs.ofType('cns.stimulation.resume');
        expect(cmd.attemptNumber).toBe(4);
        expect(cmd.stimulationAttemptId).toBe('s1#4');
        // Provenance points at the highest attempt, not at a stale array slot.
        expect(cmd.replayOf).toBe('s1#3');
    });

    it('answers the panel when a link throws instead of leaving it silent', async () => {
        // A second, concurrent Retry reaches BullMQ's `job.retry()` on a job that
        // already left the failed set: it rejects rather than queueing the run
        // twice. Right outcome — but the click still needs an answer, and an
        // escaping exception leaves the panel with none.
        const ownStore = new CNSInMemoryStimulationRepository();
        const throwing = new CNSDevToolsServer(
            new CNSDevToolsServerRepositoryInMemory(),
            ownStore,
            [
                async () => {
                    throw new Error('Job is not in the failed state');
                },
            ]
        );

        const appWs = makeWs('app');
        await throwing.handleMessage(appWs as any, JSON.stringify(topology()));
        await ownStore.saveStimulation(failedStim('s1', CNS_ID));
        await ownStore.saveAttempt(attempt('s1', 1));

        const ui = makeWs('ui');
        await throwing.handleMessage(
            ui as any,
            JSON.stringify({ type: 'client.connect' })
        );
        await throwing.handleMessage(
            ui as any,
            JSON.stringify({
                type: 'stimulation.retry',
                requestId: 'r1',
                stimulationId: 's1',
            })
        );

        expect(ui.ofType('stimulation.retry.accepted')).toBeUndefined();
        expect(ui.ofType('stimulation.retry.rejected')?.reason).toMatch(
            /failed state/
        );
        throwing.stop();
    });
});
