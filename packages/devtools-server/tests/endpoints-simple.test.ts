import { CNSDevToolsServer, ICNSDevToolsServerRepository } from '../src';
import {
    DevToolsApp,
    InitMessage,
    StimulationMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
} from '@cnstra/devtools-dto';

type SaveableMessage = any;

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
    private messages: SaveableMessage[] = [];

    // App management
    upsertApp(app: DevToolsApp): void {
        this.apps.set(app.appId, app);
    }

    listApps(): DevToolsApp[] {
        return Array.from(this.apps.values());
    }

    // Stub implementations for new methods
    upsertNeuron(): void {}
    upsertCollateral(): void {}
    upsertDendrite(): void {}
    getNeuronsByCns(): any[] {
        return [];
    }
    getCollateralsByCns(): any[] {
        return [];
    }
    getDendritesByCns(): any[] {
        return [];
    }
    saveStimulation(): void {}
    getStimulationsByApp(): any[] {
        return [];
    }
    saveResponse(): void {}
    getResponsesByCns(): any[] {
        return [];
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

    // Legacy message support
    saveMessage(message: SaveableMessage): void {
        this.messages.push(message);
    }

    getMessages(): SaveableMessage[] {
        return [...this.messages];
    }

    clear(): void {
        this.apps.clear();
        this.messages.length = 0;
    }
}

describe('DevTools Server Endpoints - Basic Coverage', () => {
    let server: CNSDevToolsServer;
    let repo: InMemoryRepo;
    let appWs: MockWebSocket;
    let clientWs: MockWebSocket;

    beforeEach(() => {
        repo = new InMemoryRepo();
        server = new CNSDevToolsServer(repo);
        appWs = new MockWebSocket() as any;
        clientWs = new MockWebSocket() as any;
    });

    afterEach(() => {
        server.stop();
        repo.clear();
    });

    describe('Client Connection', () => {
        it('should handle devtools-client-connect', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'devtools-client-connect',
            });

            expect(response).toEqual({ type: 'devtools-client-connected' });
            expect(clientWs.sentMessages).toHaveLength(1);
        });
    });

    describe('App Management', () => {
        beforeEach(async () => {
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

        it('should handle apps:list', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:list',
            });

            expect(response).toEqual({
                type: 'apps:list',
                apps: expect.arrayContaining([
                    expect.objectContaining({
                        appId: 'test-app',
                        appName: 'Test App',
                    }),
                ]),
            });
        });

        it('should handle apps:get-cns', async () => {
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

    describe('Topology', () => {
        beforeEach(async () => {
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

        it('should handle apps:get-topology', async () => {
            const response = await server.handleMessage(clientWs as any, {
                type: 'apps:get-topology',
            });

            expect(response).toEqual({
                type: 'apps:topology',
                inits: expect.arrayContaining([
                    expect.objectContaining({
                        type: 'init',
                        appId: 'test-app',
                    }),
                ]),
            });
        });

        it('should handle apps:export-topology', async () => {
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
                    }),
                ]),
            });
        });
    });

    describe('Commands', () => {
        beforeEach(async () => {
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
            expect(appWs.sentMessages).toHaveLength(1);
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
