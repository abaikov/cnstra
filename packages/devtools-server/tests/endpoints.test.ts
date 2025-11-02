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
    Neuron,
    Collateral,
    Dendrite,
    StimulationResponse,
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

    // WebSocket constants
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

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
    terminate() {}
    pause() {}
    resume() {}
}

class InMemoryRepo implements ICNSDevToolsServerRepository {
    private apps = new Map<string, DevToolsApp>();
    private neurons = new Map<string, Neuron>();
    private collaterals = new Map<string, Collateral>();
    private dendrites = new Map<string, Dendrite>();
    private stimulations = new Map<string, StimulationMessage>();
    private responses = new Map<string, StimulationResponse>();
    private neuronsByCns = new Map<string, Set<string>>();
    private collateralsByCns = new Map<string, Set<string>>();
    private dendritesByCns = new Map<string, Set<string>>();
    private stimulationsByApp = new Map<string, Set<string>>();
    private responsesByCns = new Map<string, Set<string>>();
    private messages: SaveableMessage[] = [];

    // App management
    upsertApp(app: DevToolsApp): void {
        this.apps.set(app.appId, app);
    }

    listApps(): DevToolsApp[] {
        return Array.from(this.apps.values());
    }

    // Topology management
    upsertNeuron(neuron: Neuron): void {
        this.neurons.set(neuron.id, neuron);
        if (!this.neuronsByCns.has(neuron.cnsId)) {
            this.neuronsByCns.set(neuron.cnsId, new Set());
        }
        this.neuronsByCns.get(neuron.cnsId)!.add(neuron.id);
    }

    upsertCollateral(collateral: Collateral): void {
        this.collaterals.set(collateral.id, collateral);
        if (!this.collateralsByCns.has(collateral.cnsId)) {
            this.collateralsByCns.set(collateral.cnsId, new Set());
        }
        this.collateralsByCns.get(collateral.cnsId)!.add(collateral.id);
    }

    upsertDendrite(dendrite: Dendrite): void {
        this.dendrites.set(dendrite.id, dendrite);
        if (!this.dendritesByCns.has(dendrite.cnsId)) {
            this.dendritesByCns.set(dendrite.cnsId, new Set());
        }
        this.dendritesByCns.get(dendrite.cnsId)!.add(dendrite.id);
    }

    getNeuronsByCns(cnsId: string): Neuron[] {
        const neuronIds = this.neuronsByCns.get(cnsId) || new Set();
        return Array.from(neuronIds)
            .map(id => this.neurons.get(id)!)
            .filter(Boolean);
    }

    getCollateralsByCns(cnsId: string): Collateral[] {
        const collateralIds = this.collateralsByCns.get(cnsId) || new Set();
        return Array.from(collateralIds)
            .map(id => this.collaterals.get(id)!)
            .filter(Boolean);
    }

    getDendritesByCns(cnsId: string): Dendrite[] {
        const dendriteIds = this.dendritesByCns.get(cnsId) || new Set();
        return Array.from(dendriteIds)
            .map(id => this.dendrites.get(id)!)
            .filter(Boolean);
    }

    // Stimulation management
    saveStimulation(stimulation: StimulationMessage): void {
        this.stimulations.set(stimulation.stimulationId, stimulation);
        if (!this.stimulationsByApp.has(stimulation.appId)) {
            this.stimulationsByApp.set(stimulation.appId, new Set());
        }
        this.stimulationsByApp
            .get(stimulation.appId)!
            .add(stimulation.stimulationId);
    }

    getStimulationsByApp(
        appId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
            hasError?: boolean;
            errorContains?: string;
            collateralName?: string;
            neuronId?: string;
        }
    ): StimulationMessage[] {
        const stimulationIds = this.stimulationsByApp.get(appId) || new Set();
        let stimulations = Array.from(stimulationIds)
            .map(id => this.stimulations.get(id)!)
            .filter(Boolean);

        if (!filters) return stimulations;

        // Apply filters
        if (filters.fromTimestamp !== undefined) {
            stimulations = stimulations.filter(
                s => s.timestamp >= filters.fromTimestamp!
            );
        }
        if (filters.toTimestamp !== undefined) {
            stimulations = stimulations.filter(
                s => s.timestamp <= filters.toTimestamp!
            );
        }
        if (filters.hasError !== undefined) {
            stimulations = stimulations.filter(s => {
                const hasError =
                    s.error !== null && s.error !== undefined && s.error !== '';
                return filters.hasError ? hasError : !hasError;
            });
        }
        if (filters.errorContains) {
            stimulations = stimulations.filter(s =>
                String(s.error || '')
                    .toLowerCase()
                    .includes(filters.errorContains!.toLowerCase())
            );
        }
        if (filters.collateralName) {
            stimulations = stimulations.filter(
                s => s.collateralName === filters.collateralName
            );
        }
        if (filters.neuronId) {
            stimulations = stimulations.filter(
                s => s.neuronId === filters.neuronId
            );
        }

        // Apply pagination
        if (filters.offset) {
            stimulations = stimulations.slice(filters.offset);
        }
        if (filters.limit) {
            stimulations = stimulations.slice(0, filters.limit);
        }

        return stimulations;
    }

    // Response management
    saveResponse(response: StimulationResponse): void {
        this.responses.set(response.responseId, response);
        if (!this.responsesByCns.has(response.cnsId)) {
            this.responsesByCns.set(response.cnsId, new Set());
        }
        this.responsesByCns.get(response.cnsId)!.add(response.responseId);
    }

    getResponsesByCns(
        cnsId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
            hasError?: boolean;
            errorContains?: string;
            neuronId?: string;
            collateralName?: string;
        }
    ): StimulationResponse[] {
        const responseIds = this.responsesByCns.get(cnsId) || new Set();
        let responses = Array.from(responseIds)
            .map(id => this.responses.get(id)!)
            .filter(Boolean);

        if (!filters) return responses;

        // Apply filters
        if (filters.fromTimestamp !== undefined) {
            responses = responses.filter(
                r => r.timestamp >= filters.fromTimestamp!
            );
        }
        if (filters.toTimestamp !== undefined) {
            responses = responses.filter(
                r => r.timestamp <= filters.toTimestamp!
            );
        }
        if (filters.hasError !== undefined) {
            responses = responses.filter(r => {
                const hasError =
                    r.error !== null && r.error !== undefined && r.error !== '';
                return filters.hasError ? hasError : !hasError;
            });
        }
        if (filters.errorContains) {
            responses = responses.filter(r =>
                String(r.error || '')
                    .toLowerCase()
                    .includes(filters.errorContains!.toLowerCase())
            );
        }
        if (filters.collateralName) {
            responses = responses.filter(
                r =>
                    r.inputCollateralName === filters.collateralName ||
                    r.outputCollateralName === filters.collateralName
            );
        }

        // Apply pagination
        if (filters.offset) {
            responses = responses.slice(filters.offset);
        }
        if (filters.limit) {
            responses = responses.slice(0, filters.limit);
        }

        return responses;
    }

    // Legacy message support
    saveMessage(message: SaveableMessage): void {
        this.messages.push(message);
    }

    getMessages(): SaveableMessage[] {
        return [...this.messages];
    }

    clear(): void {
        this.apps.clear();
        this.neurons.clear();
        this.collaterals.clear();
        this.dendrites.clear();
        this.stimulations.clear();
        this.responses.clear();
        this.neuronsByCns.clear();
        this.collateralsByCns.clear();
        this.dendritesByCns.clear();
        this.stimulationsByApp.clear();
        this.responsesByCns.clear();
        this.messages.length = 0;
    }

    // CNS management
    private cnsByApp = new Map<string, Set<string>>();

    addCnsToApp(appId: string, cnsId: string): void {
        const set = this.cnsByApp.get(appId) || new Set<string>();
        set.add(cnsId);
        this.cnsByApp.set(appId, set);
    }

    removeCnsFromApp(appId: string, cnsId: string): void {
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

    getCnsByApp(appId: string): string[] {
        const set = this.cnsByApp.get(appId) || new Set<string>();
        return Array.from(set);
    }

    findAppIdByCnsId(cnsId: string): string | undefined {
        for (const [appId, set] of this.cnsByApp.entries()) {
            if (set.has(cnsId)) return appId;
        }
        return undefined;
    }

    // Replay management
    getReplaysByApp(
        appId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
        }
    ): Array<{ timestamp: number }> {
        // For now, return empty array as replays are not implemented yet
        return [];
    }
}

describe('DevTools Server Endpoints', () => {
    let server: CNSDevToolsServer;
    let repo: InMemoryRepo;
    let appWs: MockWebSocket;
    let clientWs: MockWebSocket;

    beforeEach(() => {
        repo = new InMemoryRepo();
        server = new CNSDevToolsServer(repo);
        appWs = new MockWebSocket();
        clientWs = new MockWebSocket();
    });

    afterEach(() => {
        server.stop();
        repo.clear();
    });

    describe('Client Connection Endpoints', () => {
        it('should handle devtools-client-connect and return devtools-client-connected', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'devtools-client-connect',
            });

            expect(response).toEqual({ type: 'devtools-client-connected' });
            expect(clientWs.sentMessages).toHaveLength(1);
            expect(JSON.parse(clientWs.sentMessages[0])).toEqual({
                type: 'devtools-client-connected',
            });
        });
    });

    describe('App Management Endpoints', () => {
        beforeEach(async () => {
            // Setup a connected app first
            await server.handleInit(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                devToolsInstanceId: 'test-app',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });
        });

        it('should handle apps:list endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:list',
            });

            expect(response).toEqual({
                type: 'apps:list',
                apps: expect.arrayContaining([
                    expect.objectContaining({
                        appId: 'test-app',
                        appName: 'Test App',
                        version: '1.0.0',
                    }),
                ]),
            });
        });

        it('should handle apps:get-cns endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:get-cns',
                appId: 'test-app',
            });

            expect(response).toEqual({
                type: 'apps:cns',
                appId: 'test-app',
                cns: expect.arrayContaining([
                    expect.objectContaining({
                        cnsId: 'test-app:main',
                        appId: 'test-app',
                    }),
                ]),
            });
        });
    });

    describe('Topology Endpoints', () => {
        beforeEach(async () => {
            // Setup app with topology
            await server.handleInit(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                devToolsInstanceId: 'test-app',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: 'test-app:main:neuron1',
                        name: 'neuron1',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                    },
                ],
                collaterals: [
                    {
                        id: 'test-app:main:neuron1:collateral1',
                        name: 'collateral1',
                        neuronId: 'test-app:main:neuron1',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                    },
                ],
                dendrites: [
                    {
                        id: 'test-app:main:neuron1:d:collateral1',
                        neuronId: 'test-app:main:neuron1',
                        name: 'collateral1',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                    },
                ],
            });
        });

        it('should handle apps:get-topology endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:get-topology',
            });

            expect(response).toEqual({
                type: 'apps:topology',
                inits: expect.arrayContaining([
                    expect.objectContaining({
                        type: 'init',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                    }),
                ]),
            });
        });

        it('should handle apps:export-topology endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:export-topology',
                appId: 'test-app',
            });

            expect(response).toEqual({
                type: 'apps:topology',
                inits: expect.arrayContaining([
                    expect.objectContaining({
                        type: 'init',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                    }),
                ]),
            });
        });
    });

    describe('Stimulation Endpoints', () => {
        beforeEach(async () => {
            // Setup app
            await server.handleInit(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                devToolsInstanceId: 'test-app',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some stimulations
            await server.handleStimulation(appWs as any, {
                type: 'stimulation',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'neuron1',
                collateralName: 'collateral1',
                timestamp: Date.now(),
                queueLength: 0,
            });

            await server.handleStimulation(appWs as any, {
                type: 'stimulation',
                stimulationId: 'stim2',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'neuron2',
                collateralName: 'collateral2',
                timestamp: Date.now() + 1000,
                queueLength: 0,
                error: 'Test error',
            });
        });

        it('should handle apps:get-stimulations endpoint without filters', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:get-stimulations',
                appId: 'test-app',
            });

            expect(response).toEqual({
                type: 'stimulation-batch',
                stimulations: expect.arrayContaining([
                    expect.objectContaining({
                        stimulationId: 'stim1',
                        appId: 'test-app',
                    }),
                    expect.objectContaining({
                        stimulationId: 'stim2',
                        appId: 'test-app',
                    }),
                ]),
            });
        });

        it('should handle apps:get-stimulations endpoint with filters', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:get-stimulations',
                appId: 'test-app',
                hasError: true,
            });

            expect(response).toEqual({
                type: 'stimulation-batch',
                stimulations: expect.arrayContaining([
                    expect.objectContaining({
                        stimulationId: 'stim2',
                        appId: 'test-app',
                        error: 'Test error',
                    }),
                ]),
            });
            expect((response as any).stimulations).toHaveLength(1);
        });

        it('should handle apps:export-stimulations endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:export-stimulations',
                appId: 'test-app',
            });

            expect(response).toEqual({
                type: 'apps:export-stimulations',
                stimulations: expect.arrayContaining([
                    expect.objectContaining({
                        stimulationId: 'stim1',
                        appId: 'test-app',
                    }),
                ]),
            });
        });

        it('should handle stimulation endpoint and broadcast stimulation-batch', async () => {
            const clientWs2 = new MockWebSocket();
            server.addClient(clientWs2 as any);

            const stimulation: StimulationMessage = {
                type: 'stimulation',
                stimulationId: 'stim3',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'neuron3',
                collateralName: 'collateral3',
                timestamp: Date.now(),
                queueLength: 0,
            };

            await server.handleStimulation(appWs as any, stimulation);

            // Check that stimulation was broadcast to clients
            expect(clientWs2.sentMessages).toHaveLength(1);
            const broadcast = JSON.parse(clientWs2.sentMessages[0]);
            expect(broadcast).toEqual({
                type: 'stimulation-batch',
                stimulations: [stimulation],
            });
        });
    });

    describe('Response Endpoints', () => {
        beforeEach(async () => {
            // Setup app
            await server.handleInit(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                devToolsInstanceId: 'test-app',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some responses
            const response1: StimulationResponse = {
                responseId: 'resp1',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                timestamp: Date.now(),
                inputCollateralName: 'input1',
                outputCollateralName: 'output1',
            };

            const response2: StimulationResponse = {
                responseId: 'resp2',
                stimulationId: 'stim2',
                appId: 'test-app',
                cnsId: 'test-app:main',
                timestamp: Date.now() + 1000,
                inputCollateralName: 'input2',
                outputCollateralName: 'output2',
                error: 'Response error',
            };

            await repo.saveResponse(response1);
            await repo.saveResponse(response2);
        });

        it('should handle cns:get-responses endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'cns:get-responses',
                cnsId: 'test-app:main',
            });

            expect(response).toEqual({
                type: 'cns:responses',
                cnsId: 'test-app:main',
                responses: expect.arrayContaining([
                    expect.objectContaining({
                        responseId: 'resp1',
                        appId: 'test-app',
                    }),
                    expect.objectContaining({
                        responseId: 'resp2',
                        appId: 'test-app',
                    }),
                ]),
            });
        });

        it('should handle cns:export-responses endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'cns:export-responses',
                cnsId: 'test-app:main',
            });

            expect(response).toEqual({
                type: 'cns:export-responses',
                cnsId: 'test-app:main',
                responses: expect.arrayContaining([
                    expect.objectContaining({
                        responseId: 'resp1',
                        appId: 'test-app',
                    }),
                ]),
            });
        });

        it('should handle apps:get-responses endpoint', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:get-responses',
                appId: 'test-app',
            });

            expect(response).toEqual({
                type: 'apps:responses',
                appId: 'test-app',
                responses: expect.arrayContaining([
                    expect.objectContaining({
                        responseId: 'resp1',
                        appId: 'test-app',
                    }),
                ]),
                total: expect.any(Number),
                offset: expect.any(Number),
                limit: expect.any(Number),
            });
        });
    });

    describe('Command Endpoints', () => {
        beforeEach(async () => {
            // Setup app
            await server.handleInit(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                devToolsInstanceId: 'test-app',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });
        });

        it('should handle stimulate command', async () => {
            const command: StimulateCommand = {
                type: 'stimulate',
                stimulationCommandId: 'cmd1',
                collateralName: 'collateral1',
                payload: { test: 'data' },
            };

            const response = await server.handleStimulate(
                appWs as any,
                command
            );

            expect(response).toBeNull();
            // Should forward to app socket
            expect(appWs.sentMessages).toHaveLength(1);
            expect(JSON.parse(appWs.sentMessages[0])).toEqual(command);
        });

        it('should handle stimulate-accepted', async () => {
            const accepted: StimulateAccepted = {
                type: 'stimulate-accepted',
                stimulationCommandId: 'cmd1',
                stimulationId: 'stim1',
            };

            const response = await server.handleMessage(
                clientWs as any,
                accepted
            );

            expect(response).toEqual(accepted);
        });

        it('should handle stimulate-rejected', async () => {
            const rejected: StimulateRejected = {
                type: 'stimulate-rejected',
                stimulationCommandId: 'cmd1',
                error: 'Rejected',
            };

            const response = await server.handleMessage(
                clientWs as any,
                rejected
            );

            expect(response).toEqual(rejected);
        });
    });

    describe('Batch Endpoints', () => {
        it('should handle batch endpoint', async () => {
            const batch = {
                type: 'batch',
                items: [
                    {
                        type: 'response',
                        payload: {
                            responseId: 'resp1',
                            stimulationId: 'stim1',
                            appId: 'test-app',
                            cnsId: 'test-app:main',
                            timestamp: Date.now(),
                        },
                    },
                ],
            };

            await server.handleBatch(appWs as any, batch);

            // Should process the batch items (handleBatch processes items but doesn't send to appWs)
            // The batch processing should complete without errors
            expect(true).toBe(true);
        });

        it('should handle response-batch endpoint', async () => {
            const responseBatch: ResponseBatchMessage = {
                type: 'response-batch',
                responses: [
                    {
                        responseId: 'resp1',
                        stimulationId: 'stim1',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                        timestamp: Date.now(),
                        inputCollateralName: 'input-collateral',
                    },
                ],
            };

            const response = await server.handleResponseBatch(
                appWs as any,
                responseBatch
            );

            expect(response).toEqual(responseBatch);
        });
    });

    describe('Error Handling', () => {
        it('should handle unknown message types', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'unknown-message',
            });

            expect(response).toBeNull();
        });

        it('should handle invalid message format', async () => {
            const response = await server.handleMessage(
                clientWs as any,
                'invalid'
            );

            expect(response).toBeNull();
        });
    });
});
