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

describe('CNSDevToolsServer init flow', () => {
    it('records a connected app on init and reports apps:active', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        const ws = {} as unknown as import('ws').WebSocket; // minimal stub

        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'app-1',
            appName: 'Example App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                { neuronId: 'ping', appId: 'app-1', name: 'ping', axonCollaterals: ['ping'] },
                { neuronId: 'logger', appId: 'app-1', name: 'logger', axonCollaterals: ['log'] }
            ],
            collaterals: [
                { collateralName: 'ping', neuronId: 'ping', appId: 'app-1', type: 'ping' },
                { collateralName: 'log', neuronId: 'logger', appId: 'app-1', type: 'log' }
            ],
            dendrites: [
                { dendriteId: 'ping-dendrite-0', neuronId: 'ping', appId: 'app-1', collateralName: 'ping', type: 'default', collateralNames: ['ping'] },
                { dendriteId: 'logger-dendrite-0', neuronId: 'logger', appId: 'app-1', collateralName: 'log', type: 'default', collateralNames: ['log'] },
            ],
        };

        const response = await server.handleInit(ws, init);

        expect(response.type).toBe('apps:active');
        expect(Array.isArray(response.apps)).toBe(true);
        expect(response.apps.length).toBe(1);
        expect(response.apps[0].appId).toBe('app-1');
        expect(server.connectedAppCount).toBe(1);

        const active = await server.getActiveApps();
        expect(active.length).toBe(1);
        expect(active[0].appName).toBe('Example App');

        expect(repo.messages.length).toBe(1);
        expect(repo.messages[0].type).toBe('init');
    });
});
