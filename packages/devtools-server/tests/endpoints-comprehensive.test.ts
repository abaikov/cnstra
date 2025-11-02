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

    // Node.js WebSocket methods
    ping() {}
    pong() {}
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
    private messages: SaveableMessage[] = [];

    // Indexes
    private neuronsByCns = new Map<string, Set<string>>();
    private collateralsByCns = new Map<string, Set<string>>();
    private dendritesByCns = new Map<string, Set<string>>();
    private stimulationsByApp = new Map<string, Set<string>>();
    private responsesByCns = new Map<string, Set<string>>();

    async upsertApp(app: DevToolsApp): Promise<void> {
        this.apps.set(app.appId, app);
    }

    async listApps(): Promise<DevToolsApp[]> {
        return Array.from(this.apps.values());
    }

    async upsertNeuron(neuron: Neuron): Promise<void> {
        this.neurons.set(neuron.id, neuron);
        if (!this.neuronsByCns.has(neuron.cnsId)) {
            this.neuronsByCns.set(neuron.cnsId, new Set());
        }
        this.neuronsByCns.get(neuron.cnsId)!.add(neuron.id);
    }

    async upsertCollateral(collateral: Collateral): Promise<void> {
        this.collaterals.set(collateral.id, collateral);
        if (!this.collateralsByCns.has(collateral.cnsId)) {
            this.collateralsByCns.set(collateral.cnsId, new Set());
        }
        this.collateralsByCns.get(collateral.cnsId)!.add(collateral.id);
    }

    async upsertDendrite(dendrite: Dendrite): Promise<void> {
        this.dendrites.set(dendrite.id, dendrite);
        if (!this.dendritesByCns.has(dendrite.cnsId)) {
            this.dendritesByCns.set(dendrite.cnsId, new Set());
        }
        this.dendritesByCns.get(dendrite.cnsId)!.add(dendrite.id);
    }

    async getNeuronsByCns(cnsId: string): Promise<Neuron[]> {
        const neuronIds = this.neuronsByCns.get(cnsId) || new Set();
        return Array.from(neuronIds).map(id => this.neurons.get(id)!);
    }

    async getCollateralsByCns(cnsId: string): Promise<Collateral[]> {
        const collateralIds = this.collateralsByCns.get(cnsId) || new Set();
        return Array.from(collateralIds).map(id => this.collaterals.get(id)!);
    }

    async getDendritesByCns(cnsId: string): Promise<Dendrite[]> {
        const dendriteIds = this.dendritesByCns.get(cnsId) || new Set();
        return Array.from(dendriteIds).map(id => this.dendrites.get(id)!);
    }

    async saveStimulation(stimulation: StimulationMessage): Promise<void> {
        this.stimulations.set(stimulation.stimulationId, stimulation);
        if (!this.stimulationsByApp.has(stimulation.appId)) {
            this.stimulationsByApp.set(stimulation.appId, new Set());
        }
        this.stimulationsByApp
            .get(stimulation.appId)!
            .add(stimulation.stimulationId);
    }

    async getStimulationsByApp(
        appId: string,
        filters?: any
    ): Promise<StimulationMessage[]> {
        const stimulationIds = this.stimulationsByApp.get(appId) || new Set();
        let stimulations = Array.from(stimulationIds).map(
            id => this.stimulations.get(id)!
        );

        if (filters) {
            if (filters.hasError !== undefined) {
                stimulations = stimulations.filter(s => {
                    const hasError =
                        s.error !== null &&
                        s.error !== undefined &&
                        s.error !== '';
                    return filters.hasError ? hasError : !hasError;
                });
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
        }

        return stimulations;
    }

    async saveResponse(response: StimulationResponse): Promise<void> {
        this.responses.set(response.responseId, response);
        if (!this.responsesByCns.has(response.cnsId)) {
            this.responsesByCns.set(response.cnsId, new Set());
        }
        this.responsesByCns.get(response.cnsId)!.add(response.responseId);
    }

    async getResponsesByCns(
        cnsId: string,
        filters?: any
    ): Promise<StimulationResponse[]> {
        const responseIds = this.responsesByCns.get(cnsId) || new Set();
        let responses = Array.from(responseIds).map(
            id => this.responses.get(id)!
        );

        if (filters) {
            if (filters.hasError !== undefined) {
                responses = responses.filter(r => {
                    const hasError =
                        r.error !== null &&
                        r.error !== undefined &&
                        r.error !== '';
                    return filters.hasError ? hasError : !hasError;
                });
            }
            if (filters.collateralName) {
                responses = responses.filter(
                    r =>
                        r.inputCollateralName === filters.collateralName ||
                        r.outputCollateralName === filters.collateralName
                );
            }
            if (filters.neuronId) {
                responses = responses.filter(
                    r => r.stimulationId === filters.neuronId
                );
            }
        }

        return responses;
    }

    async saveMessage(message: SaveableMessage): Promise<void> {
        this.messages.push(message);
    }

    getMessagesOfType(type: string) {
        return this.messages.filter(msg => 'type' in msg && msg.type === type);
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

describe('CNSDevToolsServer - Comprehensive Endpoint Tests', () => {
    let server: CNSDevToolsServer;
    let repo: InMemoryRepo;
    let clientWs: MockWebSocket;
    let appWs: MockWebSocket;

    beforeEach(() => {
        repo = new InMemoryRepo();
        server = new CNSDevToolsServer(repo);
        clientWs = new MockWebSocket();
        appWs = new MockWebSocket();
    });

    afterEach(() => {
        server.stop();
    });

    describe('Client Connection', () => {
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

    describe('App Management', () => {
        it('should handle apps:list endpoint', async () => {
            // Add some apps to repository
            await repo.upsertApp({
                appId: 'test-app',
                appName: 'Test App',
                version: '1.0.0',
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
            });

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
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

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

    describe('Topology Management', () => {
        it('should handle apps:get-topology endpoint', async () => {
            // First add an app with topology
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
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
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                    },
                ],
                dendrites: [
                    {
                        id: 'test-app:main:neuron1:d:collateral1',
                        name: 'collateral1',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                    },
                ],
            });

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
            // First add an app with topology
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

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

    describe('Stimulation Management', () => {
        it('should handle stimulation endpoint and broadcast stimulation-batch', async () => {
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add client to receive broadcasts
            server.addClient(clientWs as any);

            const stimulation: StimulationMessage = {
                type: 'stimulation',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'test-app:main:neuron1',
                collateralName: 'collateral1',
                timestamp: Date.now(),
                queueLength: 0,
                payload: { test: 'data' },
            };

            await server.handleMessage(appWs as any, stimulation);

            // Check that stimulation was broadcast to client
            const broadcastMessages = clientWs.sentMessages.filter(msg => {
                try {
                    const parsed = JSON.parse(msg);
                    return parsed.type === 'stimulation-batch';
                } catch {
                    return false;
                }
            });

            expect(broadcastMessages.length).toBeGreaterThan(0);
            const broadcast = JSON.parse(broadcastMessages[0]);
            expect(broadcast).toEqual({
                type: 'stimulation-batch',
                stimulations: [stimulation],
            });
        });

        it('should handle apps:get-stimulations endpoint', async () => {
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some stimulations
            await repo.saveStimulation({
                type: 'stimulation',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'test-app:main:neuron1',
                collateralName: 'collateral1',
                timestamp: Date.now(),
                queueLength: 0,
            });

            await repo.saveStimulation({
                type: 'stimulation',
                stimulationId: 'stim2',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'test-app:main:neuron1',
                collateralName: 'collateral1',
                timestamp: Date.now() + 1000,
                queueLength: 0,
                error: 'Test error',
            });

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

        it('should handle apps:get-stimulations with error filter', async () => {
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some stimulations
            await repo.saveStimulation({
                type: 'stimulation',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'test-app:main:neuron1',
                collateralName: 'collateral1',
                timestamp: Date.now(),
                queueLength: 0,
            });

            await repo.saveStimulation({
                type: 'stimulation',
                stimulationId: 'stim2',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'test-app:main:neuron1',
                collateralName: 'collateral1',
                timestamp: Date.now() + 1000,
                queueLength: 0,
                error: 'Test error',
            });

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
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some stimulations
            await repo.saveStimulation({
                type: 'stimulation',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'test-app:main:neuron1',
                collateralName: 'collateral1',
                timestamp: Date.now(),
                queueLength: 0,
            });

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
    });

    describe('Response Management', () => {
        it('should handle response-batch endpoint', async () => {
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add client to receive broadcasts
            server.addClient(clientWs as any);

            const responseBatch: ResponseBatchMessage = {
                type: 'response-batch',
                responses: [
                    {
                        responseId: 'resp1',
                        stimulationId: 'stim1',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                        timestamp: Date.now(),
                        inputCollateralName: 'input1',
                        outputCollateralName: 'output1',
                    },
                    {
                        responseId: 'resp2',
                        stimulationId: 'stim2',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                        timestamp: Date.now(),
                        inputCollateralName: 'input2',
                        outputCollateralName: 'output2',
                        error: 'Response error',
                    },
                ],
            };

            const response = await server.handleResponseBatch(
                appWs as any,
                responseBatch
            );

            expect(response).toEqual(responseBatch);

            // Check that response batch was broadcast to client
            const broadcastMessages = clientWs.sentMessages.filter(msg => {
                try {
                    const parsed = JSON.parse(msg);
                    return parsed.type === 'response-batch';
                } catch {
                    return false;
                }
            });

            expect(broadcastMessages.length).toBeGreaterThan(0);
            const broadcast = JSON.parse(broadcastMessages[0]);
            expect(broadcast).toEqual(responseBatch);
        });

        it('should handle cns:get-responses endpoint', async () => {
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some responses
            await repo.saveResponse({
                responseId: 'resp1',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                timestamp: Date.now(),
                inputCollateralName: 'input1',
                outputCollateralName: 'output1',
            });

            await repo.saveResponse({
                responseId: 'resp2',
                stimulationId: 'stim2',
                appId: 'test-app',
                cnsId: 'test-app:main',
                timestamp: Date.now(),
                inputCollateralName: 'input2',
                outputCollateralName: 'output2',
                error: 'Response error',
            });

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
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some responses
            await repo.saveResponse({
                responseId: 'resp1',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                timestamp: Date.now(),
                inputCollateralName: 'input1',
                outputCollateralName: 'output1',
            });

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
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            // Add some responses
            await repo.saveResponse({
                responseId: 'resp1',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                timestamp: Date.now(),
                inputCollateralName: 'input1',
                outputCollateralName: 'output1',
            });

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

    describe('Stimulation Commands', () => {
        it('should handle stimulate command', async () => {
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            const stimulateCommand: StimulateCommand = {
                type: 'stimulate',
                stimulationCommandId: 'cmd1',
                collateralName: 'collateral1',
                payload: { test: 'data' },
            };

            const response = await server.handleMessage(
                clientWs as any,
                stimulateCommand
            );

            expect(response).toBeNull(); // stimulate returns null
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

    describe('Batch Processing', () => {
        it('should handle batch endpoint', async () => {
            // First add an app
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });

            const batchMessage = {
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

            const response = await server.handleMessage(
                appWs as any,
                batchMessage
            );

            expect(response).toBeUndefined(); // batch returns undefined
        });
    });

    describe('Replay Management', () => {
        beforeEach(async () => {
            // Setup app first
            await server.handleMessage(appWs as any, {
                type: 'init',
                appId: 'test-app',
                cnsId: 'test-app:main',
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [],
                collaterals: [],
                dendrites: [],
            });
        });

        it('should handle apps:get-replays endpoint', async () => {
            // Create replays by sending stimulate commands
            const timestamp1 = Date.now();
            const timestamp2 = Date.now() - 1000;

            await server.handleMessage(
                clientWs as any,
                {
                    type: 'stimulate',
                    stimulationCommandId: 'replay-1',
                    collateralName: 'test-collateral-1',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                    timestamp: timestamp1,
                } as any
            );

            await server.handleMessage(
                clientWs as any,
                {
                    type: 'stimulate',
                    stimulationCommandId: 'replay-2',
                    collateralName: 'test-collateral-2',
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                    timestamp: timestamp2,
                } as any
            );

            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:get-replays',
                appId: 'test-app',
            });

            expect(response).toEqual({
                type: 'apps:replays',
                appId: 'test-app',
                replays: expect.arrayContaining([
                    expect.objectContaining({
                        stimulationCommandId: 'replay-1',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                        collateralName: 'test-collateral-1',
                    }),
                    expect.objectContaining({
                        stimulationCommandId: 'replay-2',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                        collateralName: 'test-collateral-2',
                    }),
                ]),
            });

            // Verify replays are sorted by timestamp descending (most recent first)
            const replays = (response as any).replays;
            expect(replays.length).toBeGreaterThanOrEqual(2);
            if (replays.length >= 2) {
                expect(replays[0].timestamp).toBeGreaterThanOrEqual(
                    replays[1].timestamp
                );
            }
        });

        it('should create replay entry when stimulate command is sent', async () => {
            const stimulateCommand: StimulateCommand = {
                type: 'stimulate',
                stimulationCommandId: 'original-stim-123-replay-1234567890',
                collateralName: 'test-collateral',
                payload: { test: 'data' },
                appId: 'test-app',
                cnsId: 'test-app:main',
            };

            await server.handleMessage(clientWs as any, stimulateCommand);

            // Get replays and verify the entry was created
            const replaysResponse = await server.handleMessage(
                clientWs as any,
                {
                    type: 'apps:get-replays',
                    appId: 'test-app',
                }
            );

            expect(replaysResponse).toEqual({
                type: 'apps:replays',
                appId: 'test-app',
                replays: expect.arrayContaining([
                    expect.objectContaining({
                        stimulationCommandId:
                            'original-stim-123-replay-1234567890',
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                        collateralName: 'test-collateral',
                    }),
                ]),
            });
        });

        it('should update replay status to accepted when stimulate-accepted is received', async () => {
            // First create a replay by sending stimulate command
            const stimulateCommand: StimulateCommand = {
                type: 'stimulate',
                stimulationCommandId: 'test-replay-cmd-123',
                collateralName: 'test-collateral',
                payload: { test: 'data' },
                appId: 'test-app',
                cnsId: 'test-app:main',
            };

            await server.handleMessage(clientWs as any, stimulateCommand);

            // Send stimulate-accepted with appId
            const accepted: StimulateAccepted = {
                type: 'stimulate-accepted',
                stimulationCommandId: 'test-replay-cmd-123',
                stimulationId: 'test-replay-cmd-123',
                appId: 'test-app',
            };

            await server.handleMessage(appWs as any, accepted);

            // Get replays and verify status is updated
            const replaysResponse = await server.handleMessage(
                clientWs as any,
                {
                    type: 'apps:get-replays',
                    appId: 'test-app',
                }
            );

            const replays = (replaysResponse as any).replays || [];
            const replay = replays.find(
                (r: any) => r.stimulationCommandId === 'test-replay-cmd-123'
            );

            expect(replay).toBeDefined();
            expect(replay.result).toBe('accepted');
        });

        it('should update replay status to rejected when stimulate-rejected is received', async () => {
            // First create a replay by sending stimulate command
            const stimulateCommand: StimulateCommand = {
                type: 'stimulate',
                stimulationCommandId: 'test-replay-cmd-456',
                collateralName: 'test-collateral',
                payload: { test: 'data' },
                appId: 'test-app',
                cnsId: 'test-app:main',
            };

            await server.handleMessage(clientWs as any, stimulateCommand);

            // Send stimulate-rejected with appId
            const rejected: StimulateRejected = {
                type: 'stimulate-rejected',
                stimulationCommandId: 'test-replay-cmd-456',
                error: 'Collateral not found',
                appId: 'test-app',
            };

            await server.handleMessage(appWs as any, rejected);

            // Get replays and verify status is updated
            const replaysResponse = await server.handleMessage(
                clientWs as any,
                {
                    type: 'apps:get-replays',
                    appId: 'test-app',
                }
            );

            const replays = (replaysResponse as any).replays || [];
            const replay = replays.find(
                (r: any) => r.stimulationCommandId === 'test-replay-cmd-456'
            );

            expect(replay).toBeDefined();
            expect(replay.result).toBe('rejected');
        });

        it('should track multiple replays with correct statuses', async () => {
            // Create first replay
            await server.handleMessage(clientWs as any, {
                type: 'stimulate',
                stimulationCommandId: 'replay-1',
                collateralName: 'collateral1',
                appId: 'test-app',
                cnsId: 'test-app:main',
            });

            // Create second replay
            await server.handleMessage(clientWs as any, {
                type: 'stimulate',
                stimulationCommandId: 'replay-2',
                collateralName: 'collateral2',
                appId: 'test-app',
                cnsId: 'test-app:main',
            });

            // Accept first, reject second
            await server.handleMessage(appWs as any, {
                type: 'stimulate-accepted',
                stimulationCommandId: 'replay-1',
                stimulationId: 'replay-1',
                appId: 'test-app',
            });

            await server.handleMessage(appWs as any, {
                type: 'stimulate-rejected',
                stimulationCommandId: 'replay-2',
                error: 'Error',
                appId: 'test-app',
            });

            // Verify both replays have correct statuses
            const replaysResponse = await server.handleMessage(
                clientWs as any,
                {
                    type: 'apps:get-replays',
                    appId: 'test-app',
                }
            );

            const replays = (replaysResponse as any).replays || [];
            const replay1 = replays.find(
                (r: any) => r.stimulationCommandId === 'replay-1'
            );
            const replay2 = replays.find(
                (r: any) => r.stimulationCommandId === 'replay-2'
            );

            expect(replay1?.result).toBe('accepted');
            expect(replay2?.result).toBe('rejected');
        });

        it('should handle full replay flow with responses - responses should appear in list', async () => {
            const replayStimulationId = 'original-stim-123-replay-1234567890';

            // Step 1: Send replay command
            await server.handleMessage(
                clientWs as any,
                {
                    type: 'stimulate',
                    stimulationCommandId: replayStimulationId,
                    collateralName: 'test-collateral',
                    payload: { test: 'data' },
                    appId: 'test-app',
                    cnsId: 'test-app:main',
                } as any
            );

            // Step 2: App accepts the replay
            await server.handleMessage(
                appWs as any,
                {
                    type: 'stimulate-accepted',
                    stimulationCommandId: replayStimulationId,
                    stimulationId: replayStimulationId,
                    appId: 'test-app',
                } as any
            );

            // Step 3: Simulate that app sends initial stimulation message for replay
            await server.handleStimulation(appWs as any, {
                type: 'stimulation',
                stimulationId: replayStimulationId,
                appId: 'test-app',
                cnsId: 'test-app:main',
                neuronId: 'test-app:main:test-neuron',
                collateralName: 'test-collateral',
                timestamp: Date.now(),
                payload: { test: 'data' },
                queueLength: 0,
                hops: 0,
            });

            // Step 4: App sends responses with the replay stimulationId
            const responseBatch: ResponseBatchMessage = {
                type: 'response-batch',
                responses: [
                    {
                        responseId: 'test-app:resp:replay-response-1',
                        stimulationId: replayStimulationId, // This should match the replay stimulationId
                        appId: 'test-app',
                        cnsId: 'test-app:main',
                        timestamp: Date.now(),
                        inputCollateralName: 'test-collateral',
                        outputCollateralName: 'test-output',
                        inputPayload: { test: 'data' },
                        outputPayload: { result: 'ok' },
                        responsePayload: { result: 'ok' },
                    },
                ],
            };

            await server.handleResponseBatch(appWs as any, responseBatch);

            // Step 5: Verify that the response was saved with correct stimulationId
            const responsesResponse = await server.handleMessage(
                clientWs as any,
                {
                    type: 'apps:get-responses',
                    appId: 'test-app',
                }
            );

            const responses = (responsesResponse as any).responses || [];
            const replayResponse = responses.find(
                (r: any) => r.stimulationId === replayStimulationId
            );

            expect(replayResponse).toBeDefined();
            expect(replayResponse.stimulationId).toBe(replayStimulationId);
            expect(replayResponse.appId).toBe('test-app');
            expect(replayResponse.inputCollateralName).toBe('test-collateral');

            // Step 6: Verify stimulation was also saved
            const stimulationsResponse = await server.handleMessage(
                clientWs as any,
                {
                    type: 'apps:get-stimulations',
                    appId: 'test-app',
                }
            );

            const stimulations =
                (stimulationsResponse as any).stimulations || [];
            const replayStimulation = stimulations.find(
                (s: any) => s.stimulationId === replayStimulationId
            );

            expect(replayStimulation).toBeDefined();
            expect(replayStimulation.stimulationId).toBe(replayStimulationId);
            expect(replayStimulation.appId).toBe('test-app');
        });
    });

    describe('Snapshot Management', () => {
        it('should handle apps:export-snapshot endpoint', async () => {
            // First, add some data to the repository
            const app = {
                appId: 'test-app',
                appName: 'Test App',
                version: '1.0.0',
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
            };
            const neuron = {
                id: 'neuron1',
                appId: 'test-app',
                name: 'Neuron 1',
                type: 'input',
            };
            const mockResponse = {
                responseId: 'resp1',
                stimulationId: 'stim1',
                appId: 'test-app',
                cnsId: 'test-app:main',
                timestamp: Date.now(),
            };

            // Mock the repository methods
            (repo as any).listApps = jest.fn().mockResolvedValue([app]);
            (repo as any).getCnsByApp = jest
                .fn()
                .mockResolvedValue(['test-app:main']);
            (repo as any).getResponsesByCns = jest
                .fn()
                .mockResolvedValue([mockResponse]);
            (repo as any).getStimulationsByApp = jest
                .fn()
                .mockResolvedValue([]);

            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:export-snapshot',
                appId: 'test-app',
            });

            expect(response).toEqual({
                type: 'apps:snapshot',
                appId: 'test-app',
                topology: [],
                stimulations: [],
                responses: [
                    {
                        ...mockResponse,
                        contexts: undefined,
                        payload: undefined,
                        responsePayload: undefined,
                    },
                ],
                createdAt: expect.any(Number),
                sizeBytes: expect.any(Number),
            });
        });

        it('should handle apps:export-snapshot endpoint without appId (all apps)', async () => {
            // Mock the repository methods
            (repo as any).listApps = jest.fn().mockResolvedValue([]);
            (repo as any).getCnsByApp = jest.fn().mockResolvedValue([]);
            (repo as any).getResponsesByCns = jest.fn().mockResolvedValue([]);

            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:export-snapshot',
            });

            expect(response).toEqual({
                type: 'apps:snapshot',
                appId: null,
                topology: [],
                stimulations: [],
                responses: [],
                createdAt: expect.any(Number),
                sizeBytes: expect.any(Number),
            });
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
            const response = await server.handleMessage(clientWs as any, {
                invalid: 'message',
            });

            expect(response).toBeNull();
        });
    });
});
