import { CNSDevToolsServer, ICNSDevToolsServerRepository } from '../src';
import { InitMessage, DevToolsApp } from '@cnstra/devtools-dto';

class InMemoryRepo implements ICNSDevToolsServerRepository {
    private apps = new Map<string, DevToolsApp>();
    public messages: any[] = [];

    async upsertApp(app: DevToolsApp): Promise<void> {
        this.apps.set(app.appId, app);
    }

    async listApps(): Promise<DevToolsApp[]> {
        return Array.from(this.apps.values());
    }

    async saveMessage(message: any): Promise<void> {
        this.messages.push(message);
    }
}

describe('DevTools server returns topology (available for clients)', () => {
    it('stores and exposes InitMessage with neurons/collaterals/dendrites', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'topo-app',
            appName: 'Topo App',
            version: '0.0.1',
            timestamp: Date.now(),
            neurons: [
                { neuronId: 'n1', appId: 'topo-app', name: 'n1', axonCollaterals: ['c1'] },
                { neuronId: 'n2', appId: 'topo-app', name: 'n2', axonCollaterals: ['c2'] }
            ],
            collaterals: [
                { collateralName: 'c1', neuronId: 'n1', appId: 'topo-app', type: 'default' },
                { collateralName: 'c2', neuronId: 'n2', appId: 'topo-app', type: 'default' }
            ],
            dendrites: [{ dendriteId: 'n2-dendrite-0', neuronId: 'n2', appId: 'topo-app', collateralName: 'c1', type: 'default', collateralNames: ['c1'] }],
        };

        const response = await server.handleInit({} as any, init);

        // Server responds with apps:active for broadcasting
        expect(response.type).toBe('apps:active');
        expect(response.apps[0].appId).toBe('topo-app');

        // Topology is persisted verbatim and can be returned to clients by the hosting WS layer
        expect(repo.messages.length).toBe(1);
        const saved = repo.messages[0] as InitMessage;
        expect(saved.type).toBe('init');
        expect(saved.neurons.map(n => n.name)).toEqual(['n1', 'n2']);
        expect(saved.collaterals.map(c => c.collateralName)).toEqual(['c1', 'c2']);
        expect(saved.dendrites.map(d => ({ neuronId: d.neuronId, collateralName: d.collateralName }))).toEqual([
            { neuronId: 'n2', collateralName: 'c1' },
        ]);
    });
});
