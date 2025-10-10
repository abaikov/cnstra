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
        const init: any = {
            type: 'init',
            devToolsInstanceId: 'integration-app',
            appName: 'Integration Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    neuronId: 'ping',
                    appId: 'integration-app',
                    name: 'ping',
                    axonCollaterals: ['ping'],
                },
                {
                    neuronId: 'logger',
                    appId: 'integration-app',
                    name: 'logger',
                    axonCollaterals: ['log'],
                },
            ] as any,
            collaterals: [
                {
                    collateralName: 'ping',
                    neuronId: 'ping',
                    appId: 'integration-app',
                    type: 'ping',
                },
                {
                    collateralName: 'log',
                    neuronId: 'logger',
                    appId: 'integration-app',
                    type: 'log',
                },
            ],
            dendrites: [
                {
                    dendriteId: 'ping-dendrite-0',
                    neuronId: 'ping',
                    appId: 'integration-app',
                    collateralName: 'ping',
                    type: 'default',
                    collateralNames: ['ping'],
                },
                {
                    dendriteId: 'logger-dendrite-0',
                    neuronId: 'logger',
                    appId: 'integration-app',
                    collateralName: 'log',
                    type: 'default',
                    collateralNames: ['log'],
                },
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

    it('exports topology, stimulations and responses with window/pagination', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        const appWs = new MockWebSocket() as any;
        const init: any = {
            type: 'init',
            devToolsInstanceId: 'export-app',
            appName: 'Export App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    neuronId: 'worker',
                    appId: 'export-app',
                    name: 'worker',
                    axonCollaterals: ['job'],
                },
            ] as any,
            collaterals: [
                {
                    collateralName: 'job',
                    neuronId: 'worker',
                    appId: 'export-app',
                    type: 'job',
                },
            ],
            dendrites: [
                {
                    dendriteId: 'worker-d-0',
                    neuronId: 'worker',
                    appId: 'export-app',
                    collateralName: 'job',
                    type: 'default',
                    collateralNames: ['job'],
                },
            ],
        };
        await server.handleInit(appWs, init);

        const t0 = Date.now();
        for (let i = 0; i < 6; i++) {
            await server.handleMessage(appWs, {
                type: 'stimulation',
                stimulationId: `s-${i}`,
                appId: 'export-app',
                neuronId: 'worker',
                collateralName: 'job',
                timestamp: t0 + i * 10,
                payload: { i },
                queueLength: 0,
            });
        }

        // topology export
        const topoAll = await server.handleMessage(appWs, {
            type: 'apps:export-topology',
        });
        expect(topoAll.type).toBe('apps:topology');
        expect(topoAll.inits.length).toBeGreaterThanOrEqual(1);

        const topoByApp = await server.handleMessage(appWs, {
            type: 'apps:export-topology',
            appId: 'export-app',
        });
        expect(topoByApp.inits.length).toBe(1);

        // stimulations export with window
        const stimExp = await server.handleMessage(appWs, {
            type: 'apps:export-stimulations',
            appId: 'export-app',
            fromTimestamp: t0 + 20,
            toTimestamp: t0 + 50,
        });
        const ids = stimExp.stimulations.map((s: any) => s.stimulationId);
        expect(ids).toEqual(['s-2', 's-3', 's-4', 's-5']);

        // responses export: push a batch then export a page
        await server.handleMessage(appWs, {
            type: 'response-batch',
            devToolsInstanceId: 'export-app',
            responses: Array.from({ length: 5 }).map((_, i) => ({
                stimulationId: `s-${i}`,
                neuronId: 'export-app:worker',
                appId: 'export-app',
                collateralName: 'job',
                timestamp: t0 + i * 10 + 5,
            })),
        } as any);

        const respPage = await server.handleMessage(appWs, {
            type: 'cns:export-responses',
            cnsId: 'export-app',
            offset: 1,
            limit: 2,
        });
        const rids = respPage.responses.map((r: any) => r.stimulationId);
        expect(rids).toEqual(['s-1', 's-2']);

        // record and fetch replays
        await server.handleMessage(appWs, {
            type: 'stimulate',
            stimulationCommandId: 'cmd-1',
            appId: 'export-app',
            cnsId: 'export-app',
            collateralName: 'job',
            payload: { a: 1 },
        } as any);
        // simulate accepted ack
        const ack = await server.handleMessage(appWs, {
            type: 'stimulate-accepted',
            stimulationCommandId: 'cmd-1',
            appId: 'export-app',
        } as any);
        expect(ack.type).toBe('stimulate-accepted');

        const replays = await server.handleMessage(appWs, {
            type: 'apps:get-replays',
            appId: 'export-app',
            limit: 10,
        } as any);
        expect(replays.type).toBe('apps:replays');
        expect(Array.isArray(replays.replays)).toBe(true);
        expect(replays.replays[replays.replays.length - 1].result).toBe(
            'accepted'
        );

        // snapshot export
        const snapshot = await server.handleMessage(appWs, {
            type: 'apps:export-snapshot',
            appId: 'export-app',
            limitResponses: 3,
            limitStimulations: 4,
        } as any);
        expect(snapshot.type).toBe('apps:snapshot');
        expect(Array.isArray(snapshot.topology)).toBe(true);
        expect(Array.isArray(snapshot.stimulations)).toBe(true);
        expect(Array.isArray(snapshot.responses)).toBe(true);
        expect(snapshot.stimulations.length).toBeLessThanOrEqual(4);
        expect(snapshot.responses.length).toBeLessThanOrEqual(3);
        expect(typeof snapshot.sizeBytes).toBe('number');
    });

    it('filters errors in stimulations and responses using hasError and errorContains', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        const appWs = new MockWebSocket() as any;
        const init: any = {
            type: 'init',
            devToolsInstanceId: 'err-app',
            appName: 'Err App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    neuronId: 'worker',
                    appId: 'err-app',
                    name: 'worker',
                    axonCollaterals: ['job'],
                },
            ] as any,
            collaterals: [
                {
                    collateralName: 'job',
                    neuronId: 'worker',
                    appId: 'err-app',
                    type: 'job',
                },
            ],
            dendrites: [
                {
                    dendriteId: 'worker-d-0',
                    neuronId: 'worker',
                    appId: 'err-app',
                    collateralName: 'job',
                    type: 'default',
                    collateralNames: ['job'],
                },
            ],
        };
        await server.handleInit(appWs, init);

        const t0 = Date.now();
        // two stimulations, one with error
        await server.handleMessage(appWs, {
            type: 'stimulation',
            stimulationId: 's-ok',
            appId: 'err-app',
            neuronId: 'worker',
            collateralName: 'job',
            timestamp: t0,
            payload: {},
        } as any);
        await server.handleMessage(appWs, {
            type: 'stimulation',
            stimulationId: 's-err',
            appId: 'err-app',
            neuronId: 'worker',
            collateralName: 'job',
            timestamp: t0 + 1,
            payload: {},
            error: 'boom happened',
        } as any);

        // responses: one ok, one error
        await server.handleMessage(appWs, {
            type: 'response-batch',
            devToolsInstanceId: 'err-app',
            responses: [
                {
                    stimulationId: 's-ok',
                    neuronId: 'err-app:worker',
                    appId: 'err-app',
                    collateralName: 'job',
                    timestamp: t0 + 2,
                },
                {
                    stimulationId: 's-err',
                    neuronId: 'err-app:worker',
                    appId: 'err-app',
                    collateralName: 'job',
                    timestamp: t0 + 3,
                    error: 'fatal boom',
                },
            ],
        } as any);

        const onlyErrStim = await server.handleMessage(appWs, {
            type: 'apps:get-stimulations',
            appId: 'err-app',
            hasError: true,
        } as any);
        expect(onlyErrStim.type).toBe('stimulation-batch');
        expect(onlyErrStim.stimulations.length).toBe(1);
        expect(onlyErrStim.stimulations[0].stimulationId).toBe('s-err');

        const noErrStim = await server.handleMessage(appWs, {
            type: 'apps:get-stimulations',
            appId: 'err-app',
            hasError: false,
        } as any);
        expect(noErrStim.stimulations.length).toBe(1);
        expect(noErrStim.stimulations[0].stimulationId).toBe('s-ok');

        const errContains = await server.handleMessage(appWs, {
            type: 'apps:get-stimulations',
            appId: 'err-app',
            errorContains: 'boom',
        } as any);
        expect(errContains.stimulations.length).toBe(1);
        expect(errContains.stimulations[0].stimulationId).toBe('s-err');

        const onlyErrResp = await server.handleMessage(appWs, {
            type: 'cns:get-responses',
            cnsId: 'err-app',
            hasError: true,
        } as any);
        expect(onlyErrResp.responses.length).toBe(1);
        expect(onlyErrResp.responses[0].stimulationId).toBe('s-err');

        const respContains = await server.handleMessage(appWs, {
            type: 'cns:get-responses',
            cnsId: 'err-app',
            errorContains: 'fatal',
        } as any);
        expect(respContains.responses.length).toBe(1);
        expect(respContains.responses[0].stimulationId).toBe('s-err');
    });

    it('handles app disconnect and reconnect scenario', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Step 1: App connects
        const appWs = new MockWebSocket() as any;
        const init: any = {
            type: 'init',
            devToolsInstanceId: 'reconnect-app',
            appName: 'Reconnect Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                {
                    neuronId: 'test',
                    appId: 'reconnect-app',
                    name: 'test',
                    axonCollaterals: ['test'],
                },
            ] as any,
            collaterals: [
                {
                    collateralName: 'test',
                    neuronId: 'test',
                    appId: 'reconnect-app',
                    type: 'test',
                },
            ],
            dendrites: [
                {
                    dendriteId: 'test-dendrite-0',
                    neuronId: 'test',
                    appId: 'reconnect-app',
                    collateralName: 'test',
                    type: 'default',
                    collateralNames: ['test'],
                },
            ],
        };

        await server.handleInit(appWs, init);
        expect(server.connectedAppCount).toBe(1);

        // Step 2: App disconnects
        server.handleDisconnect(appWs);
        expect(server.connectedAppCount).toBe(0);

        // Step 3: Wait a bit, then app reconnects with same ID (should update lastSeenAt)
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
        const appWs2 = new MockWebSocket() as any;
        const reconnectInit: any = {
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
