import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import type { CNSDTOAppBatchMessage } from '@cnstra/devtools-dto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWs(id = 'ws') {
    const sent: string[] = [];
    return {
        _id: id,
        readyState: 1,
        sent,
        send: jest.fn((data: string) => sent.push(data)),
        lastMessage: () => JSON.parse(sent[sent.length - 1]),
        messagesOfType: (type: string) => sent.map(s => JSON.parse(s)).filter(m => m.type === type),
    };
}

const topology = (appId = 'app', cnsId = 'app:cns'): CNSDTOAppBatchMessage => ({
    type: 'batch',
    items: [{
        type: 'topology',
        appId, cnsId, appName: 'Test App', version: '1.0.0', timestamp: Date.now(),
        neurons: [{ id: `${cnsId}:authNeuron`, name: 'authNeuron', cnsId, appId }],
        collaterals: [{ id: `${cnsId}:authNeuron:user-created`, name: 'user-created', neuronId: `${cnsId}:authNeuron`, cnsId, appId }],
        dendrites: [],
    }],
});

const executionStarted = (executionId = 'exec1', appId = 'app', cnsId = 'app:cns'): CNSDTOAppBatchMessage => ({
    type: 'batch',
    items: [{
        type: 'execution.started',
        execution: {
            id: executionId, cnsId, appId,
            collateralId: `${cnsId}:authNeuron:user-created`,
            payload: { userId: '1' }, startedAt: Date.now(),
            completedAt: null, hopCount: 0, hasError: false, replayOf: null,
        },
    }],
});

const hopAdded = (executionId = 'exec1', index = 0): CNSDTOAppBatchMessage => ({
    type: 'batch',
    items: [{
        type: 'execution.hop',
        hop: {
            id: `${executionId}:${index}`, executionId, index,
            neuronId: 'app:cns:authNeuron',
            inputCollateralId: 'app:cns:authNeuron:user-created',
            outputCollateralId: 'app:cns:authNeuron:user-authenticated',
            inputPayload: { userId: '1' }, outputPayload: { token: 'abc' },
            startedAt: Date.now(), duration: null, error: null,
        },
    }],
});

const executionCompleted = (executionId = 'exec1'): CNSDTOAppBatchMessage => ({
    type: 'batch',
    items: [{
        type: 'execution.completed',
        executionId, completedAt: Date.now(), hopCount: 1, hasError: false,
    }],
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CNSDevToolsServer', () => {
    let server: CNSDevToolsServer;
    let repo: CNSDevToolsServerRepositoryInMemory;

    beforeEach(() => {
        repo = new CNSDevToolsServerRepositoryInMemory();
        server = new CNSDevToolsServer(repo);
    });

    afterEach(() => server.stop());

    // ─── Topology ─────────────────────────────────────────────────────────────

    describe('topology', () => {
        it('stores app and topology on topology batch', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));

            const apps = await repo.listApps();
            expect(apps).toHaveLength(1);
            expect(apps[0].id).toBe('app');

            const snapshots = await repo.getTopology('app:cns');
            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].neurons).toHaveLength(1);
        });

        it('broadcasts app.connected to UI clients', async () => {
            const uiWs = makeWs('ui');
            server.addClient(uiWs as any);

            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));

            const broadcasts = uiWs.messagesOfType('app.connected');
            expect(broadcasts).toHaveLength(1);
            expect(broadcasts[0].app.id).toBe('app');
        });

        it('updates topology when app reconnects', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(topology()));

            const snapshots = await repo.getTopology('app:cns');
            expect(snapshots).toHaveLength(1); // overwrites, not appends
        });
    });

    // ─── Execution events ─────────────────────────────────────────────────────

    describe('execution events', () => {
        it('stores execution on execution.started', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(executionStarted()));

            const { items } = await repo.getExecutions('app', {});
            expect(items).toHaveLength(1);
            expect(items[0].id).toBe('exec1');
        });

        it('broadcasts execution.started to UI clients', async () => {
            const uiWs = makeWs('ui');
            server.addClient(uiWs as any);

            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));
            await server.handleMessage(appWs as any, JSON.stringify(executionStarted()));

            expect(uiWs.messagesOfType('execution.started')).toHaveLength(1);
        });

        it('stores hop on execution.hop', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(executionStarted()));
            await server.handleMessage(ws as any, JSON.stringify(hopAdded()));

            const hops = await repo.getHops('exec1');
            expect(hops).toHaveLength(1);
            expect(hops[0].index).toBe(0);
        });

        it('broadcasts execution.hop to UI clients', async () => {
            const uiWs = makeWs('ui');
            server.addClient(uiWs as any);

            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(executionStarted()));
            await server.handleMessage(ws as any, JSON.stringify(hopAdded()));

            expect(uiWs.messagesOfType('execution.hop')).toHaveLength(1);
        });

        it('completes execution on execution.completed', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(executionStarted()));
            await server.handleMessage(ws as any, JSON.stringify(hopAdded()));
            await server.handleMessage(ws as any, JSON.stringify(executionCompleted()));

            const { items } = await repo.getExecutions('app', {});
            expect(items[0].completedAt).not.toBeNull();
            expect(items[0].hopCount).toBe(1);
        });
    });

    // ─── UI client queries ────────────────────────────────────────────────────

    describe('UI client queries', () => {
        it('client.connect returns apps and topology', async () => {
            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));

            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({ type: 'client.connect' }));

            const appsResult = uiWs.messagesOfType('apps.result');
            expect(appsResult).toHaveLength(1);
            expect(appsResult[0].items).toHaveLength(1);

            const topoResult = uiWs.messagesOfType('topology.result');
            expect(topoResult).toHaveLength(1);
            expect(topoResult[0].snapshots).toHaveLength(1);
        });

        it('apps.query returns list of apps', async () => {
            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));

            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({ type: 'apps.query', requestId: 'req1' }));

            const result = uiWs.messagesOfType('apps.result');
            expect(result[0].requestId).toBe('req1');
            expect(result[0].items[0].id).toBe('app');
        });

        it('topology.query returns topology', async () => {
            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));

            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({ type: 'topology.query', requestId: 'req2' }));

            const result = uiWs.messagesOfType('topology.result');
            expect(result[0].requestId).toBe('req2');
            expect(result[0].snapshots).toHaveLength(1);
        });

        it('executions.query returns executions with pagination', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(executionStarted('e1')));
            await server.handleMessage(ws as any, JSON.stringify(executionStarted('e2')));

            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({
                type: 'executions.query', requestId: 'req3',
                appId: 'app', filter: { limit: 10, offset: 0 },
            }));

            const result = uiWs.messagesOfType('executions.result');
            expect(result[0].requestId).toBe('req3');
            expect(result[0].items).toHaveLength(2);
            expect(result[0].total).toBe(2);
        });

        it('hops.query returns hops for execution', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(executionStarted()));
            await server.handleMessage(ws as any, JSON.stringify(hopAdded('exec1', 0)));
            await server.handleMessage(ws as any, JSON.stringify(hopAdded('exec1', 1)));

            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({
                type: 'hops.query', requestId: 'req4', executionId: 'exec1',
            }));

            const result = uiWs.messagesOfType('hops.result');
            expect(result[0].requestId).toBe('req4');
            expect(result[0].items).toHaveLength(2);
        });
    });

    // ─── Replay ───────────────────────────────────────────────────────────────

    describe('replay', () => {
        it('accepts replay when app is connected', async () => {
            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));

            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({
                type: 'replay.start',
                replayId: 'r1', executionId: 'exec1',
                collateralId: 'app:cns:authNeuron:user-created', payload: {},
                appId: 'app',
            }));

            expect(uiWs.messagesOfType('replay.accepted')).toHaveLength(1);
            // App should receive the replay command
            const appMessages = appWs.messagesOfType('replay.start');
            expect(appMessages).toHaveLength(1);
        });

        it('rejects replay when app is not connected', async () => {
            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({
                type: 'replay.start',
                replayId: 'r1', executionId: 'exec1',
                collateralId: 'app:cns:authNeuron:user-created',
                payload: {}, appId: 'nonexistent',
            }));

            expect(uiWs.messagesOfType('replay.rejected')).toHaveLength(1);
        });
    });

    // ─── Resilience ───────────────────────────────────────────────────────────

    describe('resilience', () => {
        it('ignores invalid JSON', async () => {
            const ws = makeWs();
            await expect(server.handleMessage(ws as any, 'not-json')).resolves.toBeUndefined();
        });

        it('ignores unknown message types', async () => {
            const ws = makeWs();
            await expect(
                server.handleMessage(ws as any, JSON.stringify({ type: 'unknown-type', foo: 'bar' }))
            ).resolves.toBeUndefined();
        });

        it('ignores invalid batch items', async () => {
            const ws = makeWs();
            await expect(
                server.handleMessage(ws as any, JSON.stringify({ type: 'batch', items: [{ type: 'topology', broken: true }] }))
            ).resolves.toBeUndefined();
        });

        it('does not send to closed UI clients', async () => {
            const uiWs = makeWs('ui');
            (uiWs as any).readyState = 3; // CLOSED
            server.addClient(uiWs as any);

            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));

            expect(uiWs.sent).toHaveLength(0);
        });
    });

    // ─── Client lifecycle ─────────────────────────────────────────────────────

    describe('client lifecycle', () => {
        it('removes client on removeClient', async () => {
            const uiWs = makeWs('ui');
            server.addClient(uiWs as any);

            server.removeClient(uiWs as any);
            uiWs.sent.length = 0;

            // Should not receive broadcasts after removal
            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));
            expect(uiWs.sent).toHaveLength(0);
        });
    });
});

// ─── In-memory repository tests ───────────────────────────────────────────────

describe('CNSDevToolsServerRepositoryInMemory', () => {
    let repo: CNSDevToolsServerRepositoryInMemory;

    beforeEach(() => {
        repo = new CNSDevToolsServerRepositoryInMemory();
    });

    it('upserts and lists apps', () => {
        repo.upsertApp({ id: 'app1', name: 'App 1', version: '1.0', connectedAt: 1, lastSeenAt: 1 });
        repo.upsertApp({ id: 'app2', name: 'App 2', version: '1.0', connectedAt: 2, lastSeenAt: 2 });
        expect(repo.listApps()).toHaveLength(2);
    });

    it('overwrites app on re-upsert', () => {
        repo.upsertApp({ id: 'app1', name: 'Old', version: '1.0', connectedAt: 1, lastSeenAt: 1 });
        repo.upsertApp({ id: 'app1', name: 'New', version: '2.0', connectedAt: 1, lastSeenAt: 2 });
        expect(repo.listApps()[0].name).toBe('New');
    });

    it('saves and gets topology', () => {
        repo.saveTopology({ cnsId: 'app:cns', appId: 'app', appName: 'App', version: '1.0', timestamp: 1, neurons: [], collaterals: [], dendrites: [] });
        expect(repo.getTopology('app:cns')).toHaveLength(1);
        expect(repo.getTopology()).toHaveLength(1);
        expect(repo.getTopology('other')).toHaveLength(0);
    });

    it('saves and gets executions with filter', () => {
        const now = Date.now();
        repo.saveExecution({ id: 'e1', cnsId: 'app:cns', appId: 'app', collateralId: 'col1', payload: null, startedAt: now, completedAt: null, hopCount: 0, hasError: false, replayOf: null });
        repo.saveExecution({ id: 'e2', cnsId: 'app:cns', appId: 'app', collateralId: 'col1', payload: null, startedAt: now + 1, completedAt: null, hopCount: 0, hasError: true, replayOf: null });

        const { items: all, total } = repo.getExecutions('app', {});
        expect(total).toBe(2);

        const { items: errors } = repo.getExecutions('app', { hasError: true });
        expect(errors).toHaveLength(1);
        expect(errors[0].id).toBe('e2');
    });

    it('completes execution', () => {
        repo.saveExecution({ id: 'e1', cnsId: 'c', appId: 'app', collateralId: 'c1', payload: null, startedAt: 1, completedAt: null, hopCount: 0, hasError: false, replayOf: null });
        repo.completeExecution('e1', Date.now(), 3, false);
        const { items } = repo.getExecutions('app', {});
        expect(items[0].hopCount).toBe(3);
        expect(items[0].completedAt).not.toBeNull();
    });

    it('saves and gets hops sorted by index', () => {
        repo.saveHop({ id: 'e1:1', executionId: 'e1', index: 1, neuronId: 'n', inputCollateralId: 'c', outputCollateralId: null, inputPayload: null, outputPayload: null, startedAt: 1, duration: null, error: null });
        repo.saveHop({ id: 'e1:0', executionId: 'e1', index: 0, neuronId: 'n', inputCollateralId: 'c', outputCollateralId: null, inputPayload: null, outputPayload: null, startedAt: 1, duration: null, error: null });

        const hops = repo.getHops('e1');
        expect(hops[0].index).toBe(0);
        expect(hops[1].index).toBe(1);
    });

    it('maps cns to app bidirectionally', () => {
        repo.addCnsToApp('app1', 'app1:cns');
        expect(repo.getCnsByApp('app1')).toContain('app1:cns');
        expect(repo.findAppByCns('app1:cns')).toBe('app1');
        expect(repo.findAppByCns('unknown')).toBeUndefined();
    });

    it('paginates executions', () => {
        for (let i = 0; i < 10; i++) {
            repo.saveExecution({ id: `e${i}`, cnsId: 'c', appId: 'app', collateralId: 'c', payload: null, startedAt: i, completedAt: null, hopCount: 0, hasError: false, replayOf: null });
        }
        const { items, total } = repo.getExecutions('app', { limit: 3, offset: 0 });
        expect(total).toBe(10);
        expect(items).toHaveLength(3);
    });

    it('clears all data', () => {
        repo.upsertApp({ id: 'a', name: 'A', version: '1', connectedAt: 1, lastSeenAt: 1 });
        repo.saveExecution({ id: 'e1', cnsId: 'c', appId: 'a', collateralId: 'c', payload: null, startedAt: 1, completedAt: null, hopCount: 0, hasError: false, replayOf: null });
        repo.clear();
        expect(repo.listApps()).toHaveLength(0);
        expect(repo.getExecutions('a', {}).total).toBe(0);
    });
});
