import { CNSDevToolsServer, ICNSDevToolsServerRepository } from '../src';
import {
    InitMessage,
    ResponseBatchMessage,
    DevToolsApp,
} from '@cnstra/devtools-dto';

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

describe('DevTools Server graph/topology data flow', () => {
    it('saves full topology from init (neurons/collaterals/dendrites) in repository', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'app-topology',
            appName: 'Topology App',
            version: '1.2.3',
            timestamp: Date.now(),
            neurons: [
                { neuronId: 'input', appId: 'app-topology', name: 'input', axonCollaterals: ['userAction'] },
                { neuronId: 'processor', appId: 'app-topology', name: 'processor', axonCollaterals: ['processed'] },
                { neuronId: 'output', appId: 'app-topology', name: 'output', axonCollaterals: ['final'] },
            ],
            collaterals: [
                { collateralName: 'userAction', neuronId: 'input', appId: 'app-topology', type: 'default' },
                { collateralName: 'processed', neuronId: 'processor', appId: 'app-topology', type: 'default' },
                { collateralName: 'final', neuronId: 'output', appId: 'app-topology', type: 'default' },
            ],
            dendrites: [
                { dendriteId: 'processor-dendrite-0', neuronId: 'processor', appId: 'app-topology', collateralName: 'userAction', type: 'default', collateralNames: ['userAction'] },
                { dendriteId: 'output-dendrite-0', neuronId: 'output', appId: 'app-topology', collateralName: 'processed', type: 'default', collateralNames: ['processed'] },
            ],
        };

        const res = await server.handleInit({} as any, init);

        // Server returns apps:active for clients
        expect(res.type).toBe('apps:active');
        expect(res.apps[0].appId).toBe('app-topology');

        // Repository must contain the original init with full topology for later retrieval/forwarding
        expect(repo.messages.length).toBe(1);
        const savedInit = repo.messages[0] as InitMessage;
        expect(savedInit.type).toBe('init');
        expect(savedInit.neurons.map(n => n.name)).toEqual([
            'input',
            'processor',
            'output',
        ]);
        expect(savedInit.collaterals.map(c => c.collateralName)).toEqual([
            'userAction',
            'processed',
            'final',
        ]);
        expect(savedInit.dendrites.map(d => ({ neuronId: d.neuronId, collateralName: d.collateralName }))).toEqual([
            { neuronId: 'processor', collateralName: 'userAction' },
            { neuronId: 'output', collateralName: 'processed' },
        ]);
    });

    it('forwards response-batch unchanged so clients can build activity', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        const batch: ResponseBatchMessage = {
            type: 'response-batch',
            instanceId: 'app-topology',
            responses: [
                {
                    stimulationId: 's1',
                    neuronId: 'processor',
                    collateralName: 'processed',
                    timestamp: Date.now(),
                    queueLength: 0,
                },
            ],
        } as any;

        const forwarded = await server.handleResponseBatch({} as any, batch);
        // The server returns the same message for broadcasting to connected clients
        expect(forwarded).toBe(batch);

        // And stores it in repository for auditing
        expect(repo.messages.length).toBe(1);
        expect((repo.messages[0] as ResponseBatchMessage).type).toBe(
            'response-batch'
        );
        expect(
            (repo.messages[0] as ResponseBatchMessage).responses.length
        ).toBe(1);
    });
});
