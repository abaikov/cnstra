import { CNSDevToolsServer, ICNSDevToolsServerRepository } from '../src';
import { InitMessage, DevToolsApp } from '@cnstra/devtools-dto';

class MockWebSocket {
    public sentMessages: string[] = [];
    public readyState = 1; // OPEN

    send(data: string) {
        this.sentMessages.push(data);
    }
}

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

describe('CNSDevToolsServer integration flow', () => {
    it('handles complete flow: app connects, devtools connects later, gets active apps', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Step 1: App connects first
        const appWs = new MockWebSocket() as any;
        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'integration-app',
            appName: 'Integration Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                { neuronId: 'ping', appId: 'integration-app', name: 'ping', axonCollaterals: ['ping'] },
                { neuronId: 'logger', appId: 'integration-app', name: 'logger', axonCollaterals: ['log'] }
            ],
            collaterals: [
                { collateralName: 'ping', neuronId: 'ping', appId: 'integration-app', type: 'ping' },
                { collateralName: 'log', neuronId: 'logger', appId: 'integration-app', type: 'log' }
            ],
            dendrites: [
                { dendriteId: 'ping-dendrite-0', neuronId: 'ping', appId: 'integration-app', collateralName: 'ping', type: 'default', collateralNames: ['ping'] },
                { dendriteId: 'logger-dendrite-0', neuronId: 'logger', appId: 'integration-app', collateralName: 'log', type: 'default', collateralNames: ['log'] },
            ],
        };

        const appsActiveResponse = await server.handleInit(appWs, init);

        // Verify init response
        expect(appsActiveResponse.type).toBe('apps:active');
        expect(appsActiveResponse.apps.length).toBe(1);
        expect(appsActiveResponse.apps[0].appId).toBe('integration-app');
        expect(server.connectedAppCount).toBe(1);

        // Step 2: DevTools client connects later (simulated)
        const devtoolsWs = new MockWebSocket() as any;
        server.addClient(devtoolsWs);

        // Simulate devtools-client-connect message handling (like in example-app)
        const activeApps = await server.getActiveApps();
        const clientConnectResponse = {
            type: 'apps:active',
            apps: activeApps,
        };

        // Verify DevTools client would receive current apps
        expect(clientConnectResponse.type).toBe('apps:active');
        expect(clientConnectResponse.apps.length).toBe(1);
        expect(clientConnectResponse.apps[0].appId).toBe('integration-app');
        expect(clientConnectResponse.apps[0].appName).toBe(
            'Integration Test App'
        );

        // Step 3: Verify persistence
        const persistedApps = await repo.listApps();
        expect(persistedApps.length).toBe(1);
        expect(persistedApps[0].appId).toBe('integration-app');

        const persistedMessages = repo.messages;
        expect(persistedMessages.length).toBe(1);
        expect(persistedMessages[0].type).toBe('init');
        expect(persistedMessages[0].devToolsInstanceId).toBe('integration-app');
    });

    it('handles app disconnect and reconnect scenario', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Step 1: App connects
        const appWs = new MockWebSocket() as any;
        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'reconnect-app',
            appName: 'Reconnect Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [{ neuronId: 'test', appId: 'reconnect-app', name: 'test', axonCollaterals: ['test'] }],
            collaterals: [{ collateralName: 'test', neuronId: 'test', appId: 'reconnect-app', type: 'test' }],
            dendrites: [{ dendriteId: 'test-dendrite-0', neuronId: 'test', appId: 'reconnect-app', collateralName: 'test', type: 'default', collateralNames: ['test'] }],
        };

        await server.handleInit(appWs, init);
        expect(server.connectedAppCount).toBe(1);

        // Step 2: App disconnects
        server.handleDisconnect(appWs);
        expect(server.connectedAppCount).toBe(0);

        // Step 3: Wait a bit, then app reconnects with same ID (should update lastSeenAt)
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
        const appWs2 = new MockWebSocket() as any;
        const reconnectInit: InitMessage = {
            ...init,
            timestamp: Date.now(), // Fresh timestamp
        };

        await server.handleInit(appWs2, reconnectInit);
        expect(server.connectedAppCount).toBe(1);

        // Step 4: DevTools connects and should see the app
        const activeApps = await server.getActiveApps();
        expect(activeApps.length).toBe(1);
        expect(activeApps[0].appId).toBe('reconnect-app');
        expect(activeApps[0].lastSeenAt).toBeGreaterThanOrEqual(
            activeApps[0].firstSeenAt
        );
    });
});
