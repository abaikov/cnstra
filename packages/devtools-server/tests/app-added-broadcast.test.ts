import { CNSDevToolsServer, ICNSDevToolsServerRepository } from '../src';
import {
    DevToolsApp,
    InitMessage,
    NeuronResponseMessage,
    ResponseBatchMessage,
    StimulationMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
} from '@cnstra/devtools-dto';

type SaveableMessage =
    | InitMessage
    | NeuronResponseMessage
    | ResponseBatchMessage
    | StimulationMessage
    | StimulateCommand
    | StimulateAccepted
    | StimulateRejected;

class MockWebSocket {
    public sentMessages: string[] = [];
    public readyState = 1; // OPEN
    public binaryType: BinaryType = 'blob';
    public bufferedAmount = 0;
    public extensions = '';
    public protocol = '';
    public url = '';

    // Event handlers
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
    onerror: ((this: WebSocket, ev: Event) => any) | null = null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
    onopen: ((this: WebSocket, ev: Event) => any) | null = null;

    // Additional properties
    isPaused = false;

    send(data: string) {
        this.sentMessages.push(data);
        // Don't log in tests to avoid async issues
    }

    close() {
        this.readyState = 3; // CLOSED
    }

    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
        return false;
    }

    // Node.js WebSocket methods
    ping() {}
    pong() {}
    terminate() {}
    pause() {}
    resume() {}

    getMessagesOfType(type: string) {
        return this.sentMessages
            .map(msg => {
                try {
                    return JSON.parse(msg);
                } catch {
                    return null;
                }
            })
            .filter(msg => msg && msg.type === type);
    }
}

class InMemoryRepo implements ICNSDevToolsServerRepository {
    private apps = new Map<string, DevToolsApp>();
    public messages: SaveableMessage[] = [];

    async upsertApp(app: DevToolsApp): Promise<void> {
        this.apps.set(app.appId, app);
    }

    async listApps(): Promise<DevToolsApp[]> {
        return Array.from(this.apps.values());
    }

    async saveMessage(message: SaveableMessage): Promise<void> {
        this.messages.push(message);
    }

    // Stub implementations for new methods
    async upsertNeuron(): Promise<void> {}
    async upsertCollateral(): Promise<void> {}
    async upsertDendrite(): Promise<void> {}
    async getNeuronsByCns(): Promise<any[]> {
        return [];
    }
    async getCollateralsByCns(): Promise<any[]> {
        return [];
    }
    async getDendritesByCns(): Promise<any[]> {
        return [];
    }
    async saveStimulation(): Promise<void> {}
    async getStimulationsByApp(): Promise<any[]> {
        return [];
    }
    async saveResponse(): Promise<void> {}
    async getResponsesByCns(): Promise<any[]> {
        return [];
    }

    // CNS management
    private cnsByApp = new Map<string, Set<string>>();

    async addCnsToApp(appId: string, cnsId: string): Promise<void> {
        const set = this.cnsByApp.get(appId) || new Set<string>();
        set.add(cnsId);
        this.cnsByApp.set(appId, set);
    }

    async removeCnsFromApp(appId: string, cnsId: string): Promise<void> {
        const set = this.cnsByApp.get(appId);
        if (set) {
            set.delete(cnsId);
            if (set.size === 0) {
                this.cnsByApp.delete(appId);
            } else {
                this.cnsByApp.set(appId, set);
            }
        }
    }

    async getCnsByApp(appId: string): Promise<string[]> {
        const set = this.cnsByApp.get(appId) || new Set<string>();
        return Array.from(set);
    }

    async findAppIdByCnsId(cnsId: string): Promise<string | undefined> {
        for (const [appId, set] of this.cnsByApp.entries()) {
            if (set.has(cnsId)) return appId;
        }
        return undefined;
    }

    // Replay management
    async getReplaysByApp(
        appId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
        }
    ): Promise<Array<{ timestamp: number }>> {
        // For now, return empty array as replays are not implemented yet
        return [];
    }
}

describe('App Added Broadcast', () => {
    afterEach(() => {
        // Stop any running servers to prevent async issues
        if (global.gc) {
            global.gc();
        }
    });

    it('should broadcast app:added when new app connects', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Step 1: DevTools client connects first
        const devtoolsWs = new MockWebSocket() as any;
        await server.handleMessage(devtoolsWs, {
            type: 'devtools-client-connect',
        });

        console.log(
            '✅ DevTools client connected, total clients:',
            server['clientSockets'].size
        );

        // Step 2: App connects and sends init
        const appWs = new MockWebSocket() as any;
        const initMessage = {
            type: 'init' as const,
            devToolsInstanceId: 'test-app',
            cnsId: 'test-app:main',
            appId: 'test-app',
            appName: 'Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'test-app:main:service',
                    name: 'service',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'test-app:main:service:event',
                    name: 'event',
                    neuronId: 'test-app:main:service',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
            dendrites: [],
        };

        console.log('📡 App sending init message...');
        await server.handleInit(appWs, initMessage);

        // Step 3: Verify app:added was sent to devtools client
        const appAddedMessages = devtoolsWs.getMessagesOfType('app:added');
        const appsActiveMessages = devtoolsWs.getMessagesOfType('apps:active');

        console.log('📊 DevTools client received messages:');
        console.log('  app:added messages:', appAddedMessages.length);
        console.log('  apps:active messages:', appsActiveMessages.length);
        console.log('  All messages:', devtoolsWs.sentMessages);

        expect(appAddedMessages.length).toBe(1);
        expect(appAddedMessages[0].app.appId).toBe('test-app');
        expect(appAddedMessages[0].app.appName).toBe('Test App');

        expect(appsActiveMessages.length).toBe(1);
        expect(appsActiveMessages[0].apps.length).toBe(1);
        expect(appsActiveMessages[0].apps[0].appId).toBe('test-app');

        // Stop server to prevent async issues
        server.stop();
    });

    it('should broadcast to multiple devtools clients', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Step 1: Multiple DevTools clients connect
        const devtoolsWs1 = new MockWebSocket() as any;
        const devtoolsWs2 = new MockWebSocket() as any;

        await server.handleMessage(devtoolsWs1, {
            type: 'devtools-client-connect',
        });
        await server.handleMessage(devtoolsWs2, {
            type: 'devtools-client-connect',
        });

        console.log(
            '✅ Two DevTools clients connected, total clients:',
            server['clientSockets'].size
        );

        // Step 2: App connects
        const appWs = new MockWebSocket() as any;
        const initMessage = {
            type: 'init' as const,
            devToolsInstanceId: 'multi-test-app',
            cnsId: 'multi-test-app:main',
            appId: 'multi-test-app',
            appName: 'Multi Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [],
            collaterals: [],
            dendrites: [],
        };

        await server.handleInit(appWs, initMessage);

        // Step 3: Verify both clients received the messages
        const client1AppAdded = devtoolsWs1.getMessagesOfType('app:added');
        const client2AppAdded = devtoolsWs2.getMessagesOfType('app:added');
        const client1AppsActive = devtoolsWs1.getMessagesOfType('apps:active');
        const client2AppsActive = devtoolsWs2.getMessagesOfType('apps:active');

        console.log('📊 Client 1 received:', {
            appAdded: client1AppAdded.length,
            appsActive: client1AppsActive.length,
        });
        console.log('📊 Client 2 received:', {
            appAdded: client2AppAdded.length,
            appsActive: client2AppsActive.length,
        });

        expect(client1AppAdded.length).toBe(1);
        expect(client2AppAdded.length).toBe(1);
        expect(client1AppsActive.length).toBe(1);
        expect(client2AppsActive.length).toBe(1);

        expect(client1AppAdded[0].app.appId).toBe('multi-test-app');
        expect(client2AppAdded[0].app.appId).toBe('multi-test-app');

        // Stop server to prevent async issues
        server.stop();
    });

    it('should not broadcast if no devtools clients are connected', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // No devtools clients connected
        console.log(
            '📊 No DevTools clients connected, total clients:',
            server['clientSockets'].size
        );

        // App connects
        const appWs = new MockWebSocket() as any;
        const initMessage = {
            type: 'init' as const,
            devToolsInstanceId: 'no-clients-app',
            cnsId: 'no-clients-app:main',
            appId: 'no-clients-app',
            appName: 'No Clients App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [],
            collaterals: [],
            dendrites: [],
        };

        await server.handleInit(appWs, initMessage);

        // Verify no messages were sent (since no clients)
        expect(server['clientSockets'].size).toBe(0);

        // Stop server to prevent async issues
        server.stop();
    });
});
