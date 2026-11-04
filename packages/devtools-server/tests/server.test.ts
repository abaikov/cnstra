import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import type { TCNSAppBatchMessageDTO } from '@cnstra/devtools-dto';
import { readSync } from './readSync';

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

const topology = (appId = 'app', cnsId = 'app:cns'): TCNSAppBatchMessageDTO => ({
    type: 'batch',
    items: [{
        type: 'topology',
        appId, cnsId, appName: 'Test App', version: '1.0.0', timestamp: Date.now(),
        neurons: [{ name: 'authNeuron', cnsId, appId }],
        collaterals: [{ name: 'user-created', ownerNeuronName: 'authNeuron', cnsId, appId }],
        dendrites: [],
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


    // ─── Topology ─────────────────────────────────────────────────────────────

    describe('topology', () => {
        it('stores app and topology on topology batch', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));

            expect(await server.getActiveApps()).toEqual([{ id: 'app', name: expect.any(String), version: expect.any(String) }]);

            const snapshots = await repo.getTopology('app:cns');
            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].neurons).toHaveLength(1);
        });

        it('lists one app per appId with the name and version of its newest snapshot', async () => {
            await repo.saveTopology({ cnsId: 'app:a', appId: 'app', appName: 'Old', version: '1.0.0', timestamp: 2, neurons: [], collaterals: [], dendrites: [] });
            await repo.saveTopology({ cnsId: 'app:b', appId: 'app', appName: 'New', version: '2.0.0', timestamp: 3, neurons: [], collaterals: [], dendrites: [] });
            await repo.saveTopology({ cnsId: 'other:a', appId: 'other', appName: 'Other', version: '1.0.0', timestamp: 1, neurons: [], collaterals: [], dendrites: [] });

            expect(await server.getActiveApps()).toEqual([
                { id: 'app', name: 'New', version: '2.0.0' },
                { id: 'other', name: 'Other', version: '1.0.0' },
            ]);
        });

        it('updates topology when app reconnects', async () => {
            const ws = makeWs();
            await server.handleMessage(ws as any, JSON.stringify(topology()));
            await server.handleMessage(ws as any, JSON.stringify(topology()));

            const snapshots = await repo.getTopology('app:cns');
            expect(snapshots).toHaveLength(1); // overwrites, not appends
        });
    });

    // ─── UI client queries ────────────────────────────────────────────────────

    describe('UI client queries', () => {
        it('client.connect answers the panel config and nothing else', async () => {
            const uiWs = makeWs('ui');
            await server.handleMessage(uiWs as any, JSON.stringify({ type: 'client.connect' }));
            expect(uiWs.sent.map(frame => JSON.parse(frame).type)).toEqual(['ui.config']);
        });

        it('the apps key answers the connected apps', async () => {
            const appWs = makeWs('app');
            await server.handleMessage(appWs as any, JSON.stringify(topology()));
            expect(await readSync(server, 'apps', [undefined])).toEqual({ apps: [{ id: 'app', name: 'Test App', version: '1.0.0' }] });
        });

        it('the topology key answers every snapshot of its scope flattened', async () => {
            await server.handleMessage(makeWs('app') as any, JSON.stringify(topology()));
            await server.handleMessage(makeWs('other') as any, JSON.stringify(topology('other', 'other:cns')));
            expect((await readSync(server, 'topology', ['app:cns'])).neurons).toEqual([{ name: 'authNeuron', cnsId: 'app:cns', appId: 'app' }]);
            expect((await readSync(server, 'topology', [undefined])).neurons.map(neuron => neuron.cnsId)).toEqual(['app:cns', 'other:cns']);
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
    });
});

// ─── In-memory repository tests ───────────────────────────────────────────────

describe('CNSDevToolsServerRepositoryInMemory', () => {
    let repo: CNSDevToolsServerRepositoryInMemory;

    beforeEach(() => {
        repo = new CNSDevToolsServerRepositoryInMemory();
    });

    it('saves and gets topology', () => {
        repo.saveTopology({ cnsId: 'app:cns', appId: 'app', appName: 'App', version: '1.0', timestamp: 1, neurons: [], collaterals: [], dendrites: [] });
        expect(repo.getTopology('app:cns')).toHaveLength(1);
        expect(repo.getTopology()).toHaveLength(1);
        expect(repo.getTopology('other')).toHaveLength(0);
    });

    it('finds the app of a cns from its topology', () => {
        repo.saveTopology({ cnsId: 'app1:cns', appId: 'app1', appName: 'App', version: '1.0', timestamp: 1, neurons: [], collaterals: [], dendrites: [] });
        expect(repo.findAppByCns('app1:cns')).toBe('app1');
        expect(repo.findAppByCns('unknown')).toBeUndefined();
    });

    it('clears all data', () => {
        repo.saveTopology({ cnsId: 'a:cns', appId: 'a', appName: 'A', version: '1', timestamp: 1, neurons: [], collaterals: [], dendrites: [] });
        repo.clear();
        expect(repo.getTopology()).toHaveLength(0);
    });
});
