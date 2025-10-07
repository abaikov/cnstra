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

describe('CNSDevToolsServer late client connection', () => {
    it('sends current apps list when devtools client connects later', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Simulate app connecting first
        const appWs = {} as unknown as import('ws').WebSocket;
        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'app-1',
            appName: 'Example App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [{ neuronId: 'ping', appId: 'app-1', name: 'ping', axonCollaterals: ['ping'] }],
            collaterals: [{ collateralName: 'ping', neuronId: 'ping', appId: 'app-1', type: 'ping' }],
            dendrites: [{ dendriteId: 'ping-dendrite-0', neuronId: 'ping', appId: 'app-1', collateralName: 'ping', type: 'default', collateralNames: ['ping'] }],
        };

        // App connects and registers
        await server.handleInit(appWs, init);
        expect(server.connectedAppCount).toBe(1);

        // Later, DevTools UI client connects (simulated via getActiveApps)
        const activeApps = await server.getActiveApps();

        expect(activeApps.length).toBe(1);
        expect(activeApps[0].appId).toBe('app-1');
        expect(activeApps[0].appName).toBe('Example App');

        // Verify the app is still tracked in the server
        const repoApps = await repo.listApps();
        expect(repoApps.length).toBe(1);
        expect(repoApps[0].appId).toBe('app-1');
    });

    it('handles multiple apps connecting before devtools client', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Connect two apps
        const app1Ws = {} as unknown as import('ws').WebSocket;
        const app2Ws = {} as unknown as import('ws').WebSocket;

        const init1: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'app-1',
            appName: 'First App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [{ neuronId: 'ping', appId: 'app-1', name: 'ping', axonCollaterals: ['ping'] }],
            collaterals: [{ collateralName: 'ping', neuronId: 'ping', appId: 'app-1', type: 'ping' }],
            dendrites: [{ dendriteId: 'ping-dendrite-0', neuronId: 'ping', appId: 'app-1', collateralName: 'ping', type: 'default', collateralNames: ['ping'] }],
        };

        const init2: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'app-2',
            appName: 'Second App',
            version: '2.0.0',
            timestamp: Date.now(),
            neurons: [{ neuronId: 'logger', appId: 'app-2', name: 'logger', axonCollaterals: ['log'] }],
            collaterals: [{ collateralName: 'log', neuronId: 'logger', appId: 'app-2', type: 'log' }],
            dendrites: [{ dendriteId: 'logger-dendrite-0', neuronId: 'logger', appId: 'app-2', collateralName: 'log', type: 'default', collateralNames: ['log'] }],
        };

        await server.handleInit(app1Ws, init1);
        await server.handleInit(app2Ws, init2);

        expect(server.connectedAppCount).toBe(2);

        // DevTools client connects and should get both apps
        const activeApps = await server.getActiveApps();

        expect(activeApps.length).toBe(2);

        const appNames = activeApps.map(app => app.appName).sort();
        expect(appNames).toEqual(['First App', 'Second App']);

        const appIds = activeApps.map(app => app.appId).sort();
        expect(appIds).toEqual(['app-1', 'app-2']);
    });
});
