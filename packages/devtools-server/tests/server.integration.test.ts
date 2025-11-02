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
}

class InMemoryRepo implements ICNSDevToolsServerRepository {
    private apps = new Map<string, DevToolsApp>();
    private neurons = new Map<string, any>();
    private collaterals = new Map<string, any>();
    private dendrites = new Map<string, any>();
    private stimulations = new Map<string, any>();
    private responses = new Map<string, any>();

    async upsertApp(app: DevToolsApp): Promise<void> {
        this.apps.set(app.appId, app);
    }

    async listApps(): Promise<DevToolsApp[]> {
        return Array.from(this.apps.values());
    }

    // Stub implementations for new methods
    async upsertNeuron(neuron: any): Promise<void> {
        this.neurons.set(neuron.id, neuron);
    }
    async upsertCollateral(collateral: any): Promise<void> {
        this.collaterals.set(collateral.id, collateral);
    }
    async upsertDendrite(dendrite: any): Promise<void> {
        this.dendrites.set(dendrite.id, dendrite);
    }
    async getNeuronsByCns(cnsId: string): Promise<any[]> {
        return Array.from(this.neurons.values()).filter(n => n.cnsId === cnsId);
    }
    async getCollateralsByCns(cnsId: string): Promise<any[]> {
        return Array.from(this.collaterals.values()).filter(
            c => c.cnsId === cnsId
        );
    }
    async getDendritesByCns(cnsId: string): Promise<any[]> {
        return Array.from(this.dendrites.values()).filter(
            d => d.cnsId === cnsId
        );
    }

    // Remove methods for cleanup
    async removeNeuron(neuronId: string): Promise<void> {
        this.neurons.delete(neuronId);
    }
    async removeCollateral(collateralId: string): Promise<void> {
        this.collaterals.delete(collateralId);
    }
    async removeDendrite(dendriteId: string): Promise<void> {
        this.dendrites.delete(dendriteId);
    }
    async saveStimulation(stimulation: any): Promise<void> {
        this.stimulations.set(stimulation.stimulationId, stimulation);
    }
    async getStimulationsByApp(appId: string, filters?: any): Promise<any[]> {
        return Array.from(this.stimulations.values()).filter(
            s => s.appId === appId
        );
    }
    async saveResponse(response: any): Promise<void> {
        this.responses.set(response.responseId, response);
    }
    async getResponsesByCns(cnsId: string, filters?: any): Promise<any[]> {
        return Array.from(this.responses.values()).filter(
            r => r.cnsId === cnsId
        );
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
        for (const [appId, set] of Array.from(this.cnsByApp.entries())) {
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

describe('CNSDevToolsServer - Modern Protocol', () => {
    it('receives init + response-batch from DevTools (NO stimulation messages)', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);
        const ws = new MockWebSocket() as any;

        // Step 1: DevTools sends init with full topology
        const init: InitMessage = {
            type: 'init',
            appId: 'test-app',
            cnsId: 'test-app:main',
            devToolsInstanceId: 'test-app',
            appName: 'Test Application',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'test-app:main:worker',
                    name: 'worker',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'test-app:main:worker:job-input',
                    name: 'job-input',
                    neuronId: 'test-app:main:worker',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
                {
                    id: 'test-app:main:worker:work-done',
                    name: 'work-done',
                    neuronId: 'test-app:main:worker',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
            dendrites: [
                {
                    id: 'test-app:main:worker:d:job-input',
                    neuronId: 'test-app:main:worker',
                    name: 'job-input',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                },
            ],
        };

        const initResponse = await server.handleInit(ws, init);

        // Verify init response
        expect(initResponse.type).toBe('apps:active');
        expect(initResponse.apps.length).toBe(1);
        expect(initResponse.apps[0].appId).toBe('test-app');
        expect(initResponse.apps[0].appName).toBe('Test Application');
        expect(server.connectedAppCount).toBe(1);

        // Step 2: DevTools sends response-batch (modern protocol)
        await server.handleMessage(ws, {
            type: 'response-batch',
            responses: Array.from({ length: 10 }, (_, i) => ({
                responseId: `test-app:resp:stim-${i}:${Date.now() + i}`,
                stimulationId: `stim-${i}`,
                cnsId: 'test-app:main',
                appId: 'test-app',
                timestamp: Date.now() + i,
                inputCollateralName: 'job-input',
                outputCollateralName: 'work-done',
                inputPayload: { jobId: i, task: `task-${i}` },
                outputPayload: { result: `completed-${i}` },
                responsePayload: { result: `completed-${i}` },
                duration: 50 + i * 5,
            })),
        } as any);

        // Step 3: Verify that the server processed the messages correctly
        // The server should have stored the app and responses in the repository
        const apps = await repo.listApps();
        expect(apps.length).toBe(1);
        expect(apps[0].appId).toBe('test-app');

        // Verify responses were saved
        const responses = await repo.getResponsesByCns('test-app:main');
        expect(responses.length).toBe(10);
        expect(responses[0].appId).toBe('test-app');
        expect(responses[0].inputCollateralName).toBe('job-input');
        expect(responses[0].outputCollateralName).toBe('work-done');
    });

    it('handles multiple apps sending init + responses', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);
        const ws1 = new MockWebSocket() as any;
        const ws2 = new MockWebSocket() as any;

        // App 1
        await server.handleInit(ws1, {
            type: 'init',
            devToolsInstanceId: 'app-1',
            cnsId: 'app-1:main',
            appId: 'app-1',
            appName: 'App One',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'app-1:main:service-a',
                    name: 'service-a',
                    appId: 'app-1',
                    cnsId: 'app-1:main',
                },
            ],
            collaterals: [
                {
                    collateralName: 'event-a',
                    neuronId: 'app-1:main:service-a',
                    appId: 'app-1',
                    cnsId: 'app-1:main',
                    type: 'event',
                },
            ],
            dendrites: [],
        } as any);

        // App 2
        await server.handleInit(ws2, {
            type: 'init',
            devToolsInstanceId: 'app-2',
            cnsId: 'app-2:main',
            appId: 'app-2',
            appName: 'App Two',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'app-2:main:service-b',
                    name: 'service-b',
                    appId: 'app-2',
                    cnsId: 'app-2:main',
                },
            ],
            collaterals: [
                {
                    collateralName: 'event-b',
                    neuronId: 'app-2:main:service-b',
                    appId: 'app-2',
                    cnsId: 'app-2:main',
                    type: 'event',
                },
            ],
            dendrites: [],
        } as any);

        expect(server.connectedAppCount).toBe(2);

        // Both apps send responses
        await server.handleMessage(ws1, {
            type: 'response-batch',
            responses: [
                {
                    responseId: 'app-1:resp:s1',
                    stimulationId: 's1',
                    cnsId: 'app-1:main',
                    appId: 'app-1',
                    timestamp: Date.now(),
                    inputCollateralName: 'trigger',
                    outputCollateralName: 'event-a',
                    inputPayload: {},
                    outputPayload: {},
                    responsePayload: {},
                },
            ],
        } as any);

        await server.handleMessage(ws2, {
            type: 'response-batch',
            responses: [
                {
                    responseId: 'app-2:resp:s2',
                    stimulationId: 's2',
                    cnsId: 'app-2:main',
                    appId: 'app-2',
                    timestamp: Date.now(),
                    inputCollateralName: 'trigger',
                    outputCollateralName: 'event-b',
                    inputPayload: {},
                    outputPayload: {},
                    responsePayload: {},
                },
            ],
        } as any);

        // Verify that both apps were stored
        const apps = await repo.listApps();
        expect(apps.length).toBe(2);
        expect(apps.some(app => app.appId === 'app-1')).toBe(true);
        expect(apps.some(app => app.appId === 'app-2')).toBe(true);

        // Verify responses were saved for both apps
        const app1Responses = await repo.getResponsesByCns('app-1:main');
        const app2Responses = await repo.getResponsesByCns('app-2:main');

        expect(app1Responses.length).toBe(1);
        expect(app2Responses.length).toBe(1);
    });

    it('persists response batches for later querying', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);
        const ws = new MockWebSocket() as any;

        await server.handleInit(ws, {
            type: 'init',
            devToolsInstanceId: 'query-app',
            cnsId: 'query-app:main',
            appId: 'query-app',
            appName: 'Query App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'query-app:main:processor',
                    name: 'processor',
                    appId: 'query-app',
                    cnsId: 'query-app:main',
                },
            ],
            collaterals: [
                {
                    collateralName: 'result',
                    neuronId: 'query-app:main:processor',
                    appId: 'query-app',
                    cnsId: 'query-app:main',
                    type: 'output',
                },
            ],
            dendrites: [],
        } as any);

        // Send 5 responses
        const batchResponse = await server.handleMessage(ws, {
            type: 'response-batch',
            responses: Array.from({ length: 5 }, (_, i) => ({
                responseId: `query-app:resp:q-${i}`,
                stimulationId: `q-${i}`,
                cnsId: 'query-app:main',
                appId: 'query-app',
                timestamp: Date.now() + i * 100,
                inputCollateralName: 'input',
                outputCollateralName: 'result',
                inputPayload: { n: i },
                outputPayload: { result: i * 2 },
                responsePayload: { result: i * 2 },
            })),
        } as any);

        // Verify batch was echoed back
        expect((batchResponse as any).type).toBe('response-batch');
        expect((batchResponse as any).responses.length).toBe(5);

        // Verify responses were persisted in repository
        const responses = await repo.getResponsesByCns('query-app:main');
        expect(responses.length).toBe(5);
    });

    it('handles app disconnect and reconnect', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);
        const ws1 = new MockWebSocket() as any;

        await server.handleInit(ws1, {
            type: 'init',
            devToolsInstanceId: 'reconnect-app',
            cnsId: 'reconnect-app:main',
            appId: 'reconnect-app',
            appName: 'Reconnect App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'reconnect-app:main:worker',
                    name: 'worker',
                    appId: 'reconnect-app',
                    cnsId: 'reconnect-app:main',
                },
            ],
            collaterals: [
                {
                    collateralName: 'work',
                    neuronId: 'reconnect-app:main:worker',
                    appId: 'reconnect-app',
                    cnsId: 'reconnect-app:main',
                    type: 'output',
                },
            ],
            dendrites: [],
        } as any);

        expect(server.connectedAppCount).toBe(1);

        // Disconnect
        server.handleDisconnect(ws1);
        expect(server.connectedAppCount).toBe(0);

        // Reconnect
        const ws2 = new MockWebSocket() as any;
        await server.handleInit(ws2, {
            type: 'init',
            devToolsInstanceId: 'reconnect-app',
            cnsId: 'reconnect-app:main',
            appId: 'reconnect-app',
            appName: 'Reconnect App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'reconnect-app:main:worker',
                    name: 'worker',
                    appId: 'reconnect-app',
                    cnsId: 'reconnect-app:main',
                },
            ],
            collaterals: [
                {
                    collateralName: 'work',
                    neuronId: 'reconnect-app:main:worker',
                    appId: 'reconnect-app',
                    cnsId: 'reconnect-app:main',
                    type: 'output',
                },
            ],
            dendrites: [],
        } as any);

        expect(server.connectedAppCount).toBe(1);

        const activeApps = await server.getActiveApps();
        expect(activeApps.length).toBe(1);
        expect(activeApps[0].appId).toBe('reconnect-app');
    });

    it('cleans up old topology data when app reconnects with different topology', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);
        const ws1 = new MockWebSocket() as any;

        // First connection with initial topology
        await server.handleInit(ws1, {
            type: 'init',
            devToolsInstanceId: 'topology-change-app',
            cnsId: 'topology-change-app:main',
            appId: 'topology-change-app',
            appName: 'Topology Change App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'topology-change-app:main:old-neuron',
                    name: 'old-neuron',
                    appId: 'topology-change-app',
                    cnsId: 'topology-change-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'topology-change-app:main:old-neuron:old-collateral',
                    name: 'old-collateral',
                    neuronId: 'topology-change-app:main:old-neuron',
                    appId: 'topology-change-app',
                    cnsId: 'topology-change-app:main',
                },
            ],
            dendrites: [],
        } as any);

        expect(server.connectedAppCount).toBe(1);

        // Verify initial topology is stored
        const initialNeurons = await repo.getNeuronsByCns(
            'topology-change-app:main'
        );
        const initialCollaterals = await repo.getCollateralsByCns(
            'topology-change-app:main'
        );
        expect(initialNeurons).toHaveLength(1);
        expect(initialCollaterals).toHaveLength(1);
        expect(initialNeurons[0].name).toBe('old-neuron');
        expect(initialCollaterals[0].name).toBe('old-collateral');

        // Disconnect
        server.handleDisconnect(ws1);
        expect(server.connectedAppCount).toBe(0);

        // Reconnect with completely different topology
        const ws2 = new MockWebSocket() as any;
        await server.handleInit(ws2, {
            type: 'init',
            devToolsInstanceId: 'topology-change-app',
            cnsId: 'topology-change-app:main',
            appId: 'topology-change-app',
            appName: 'Topology Change App',
            version: '2.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    id: 'topology-change-app:main:new-neuron',
                    name: 'new-neuron',
                    appId: 'topology-change-app',
                    cnsId: 'topology-change-app:main',
                },
            ],
            collaterals: [
                {
                    id: 'topology-change-app:main:new-neuron:new-collateral',
                    name: 'new-collateral',
                    neuronId: 'topology-change-app:main:new-neuron',
                    appId: 'topology-change-app',
                    cnsId: 'topology-change-app:main',
                },
            ],
            dendrites: [],
        } as any);

        expect(server.connectedAppCount).toBe(1);

        // Verify old topology is cleaned up and new topology is stored
        const finalNeurons = await repo.getNeuronsByCns(
            'topology-change-app:main'
        );
        const finalCollaterals = await repo.getCollateralsByCns(
            'topology-change-app:main'
        );

        expect(finalNeurons).toHaveLength(1);
        expect(finalCollaterals).toHaveLength(1);
        expect(finalNeurons[0].name).toBe('new-neuron');
        expect(finalCollaterals[0].name).toBe('new-collateral');

        // Verify old data is gone
        expect(finalNeurons.find(n => n.name === 'old-neuron')).toBeUndefined();
        expect(
            finalCollaterals.find(c => c.name === 'old-collateral')
        ).toBeUndefined();
    });

    it('Server broadcasts metrics to connected clients', async () => {
        const server = new CNSDevToolsServer(new InMemoryRepo());
        const mockWs = new MockWebSocket();

        // 1. App connects and sends init
        const initMessage = {
            type: 'init',
            appId: 'test-app',
            cnsId: 'test-app:core',
            appName: 'Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [],
            collaterals: [],
            dendrites: [],
        };

        await server.handleMessage(mockWs as any, initMessage);

        // 2. DevTools client connects
        const devtoolsWs = new MockWebSocket() as any;
        await server.handleMessage(devtoolsWs, {
            type: 'devtools-client-connect',
        });

        // 3. Wait for metrics to be sent (server sends metrics every 1 second)
        await new Promise(resolve => setTimeout(resolve, 1200));

        // 4. Verify metrics were sent
        const metricsMessages = devtoolsWs.sentMessages.filter(
            (msg: string) => {
                const parsed = JSON.parse(msg);
                return parsed.type === 'server:metrics';
            }
        );

        server.stop();

        expect(metricsMessages.length).toBeGreaterThan(0);

        const metricsMsg = JSON.parse(metricsMessages[0]);
        expect(metricsMsg.type).toBe('server:metrics');
        expect(metricsMsg.timestamp).toBeDefined();
        expect(metricsMsg.rssMB).toBeDefined();
        expect(metricsMsg.heapUsedMB).toBeDefined();
        expect(metricsMsg.heapTotalMB).toBeDefined();
        expect(metricsMsg.externalMB).toBeDefined();
        expect(metricsMsg.cpuPercent).toBeDefined();
    });
});
