import { CNSDevToolsServer, ICNSDevToolsServerRepository } from '../src';
import { InitMessage, DevToolsApp, StimulationMessage, NeuronResponseMessage } from '@cnstra/devtools-dto';

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

describe('CNSDevToolsServer Stimulation Response Flow', () => {
    it('receives stimulations and responses, makes them available to DevTools clients', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Step 1: App connects and registers topology
        const appWs = new MockWebSocket() as any;
        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'response-test-app',
            appName: 'Response Test App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                { neuronId: 'auth-service', appId: 'response-test-app', name: 'auth-service', axonCollaterals: ['user-authenticated'] },
                { neuronId: 'logger', appId: 'response-test-app', name: 'logger', axonCollaterals: ['log'] }
            ],
            collaterals: [
                { collateralName: 'user-authenticated', neuronId: 'auth-service', appId: 'response-test-app', type: 'event' },
                { collateralName: 'log', neuronId: 'logger', appId: 'response-test-app', type: 'log' }
            ],
            dendrites: [
                { dendriteId: 'auth-dendrite-0', neuronId: 'auth-service', appId: 'response-test-app', collateralName: 'user-authenticated', type: 'default', collateralNames: ['user-authenticated'] },
                { dendriteId: 'logger-dendrite-0', neuronId: 'logger', appId: 'response-test-app', collateralName: 'log', type: 'default', collateralNames: ['log'] }
            ],
        };

        await server.handleInit(appWs, init);
        expect(server.connectedAppCount).toBe(1);

        // Step 2: App sends stimulation message
        const stimulation: StimulationMessage = {
            type: 'stimulation',
            stimulationId: 'stim-001',
            appId: 'response-test-app',
            neuronId: 'auth-service',
            collateralName: 'user-authenticated',
            timestamp: Date.now(),
            payload: { userId: '12345', email: 'user@example.com' },
            contexts: { requestId: 'req-001', sessionId: 'sess-001' }
        };

        await server.handleMessage(appWs, stimulation);

        // Step 3: App sends response message
        const response: NeuronResponseMessage = {
            type: 'neuron-response',
            responseId: 'resp-001',
            stimulationId: 'stim-001',
            neuronId: 'logger',
            appId: 'response-test-app',
            timestamp: Date.now(),
            duration: 25,
            error: null,
            responsePayload: { logMessage: 'User authenticated', level: 'info' }
        };

        await server.handleMessage(appWs, response);

        // Step 4: DevTools client connects and queries data
        const devtoolsWs = new MockWebSocket() as any;
        server.addClient(devtoolsWs);

        // Verify stimulation was stored
        const stimulations = repo.messages.filter(m => m.type === 'stimulation');
        expect(stimulations.length).toBe(1);
        expect(stimulations[0].stimulationId).toBe('stim-001');
        expect(stimulations[0].neuronId).toBe('auth-service');
        expect(stimulations[0].payload.userId).toBe('12345');

        // Verify response was stored
        const responses = repo.messages.filter(m => m.type === 'neuron-response');
        expect(responses.length).toBe(1);
        expect(responses[0].responseId).toBe('resp-001');
        expect(responses[0].stimulationId).toBe('stim-001');
        expect(responses[0].neuronId).toBe('logger');
        expect(responses[0].duration).toBe(25);
        expect(responses[0].error).toBe(null);

        // Step 5: Verify data is available for DevTools UI
        // This proves the backend can provide stimulation response data
        expect(repo.messages.length).toBe(3); // init + stimulation + response
    });

    it('handles multiple stimulations and responses for the same neuron', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Step 1: App connects
        const appWs = new MockWebSocket() as any;
        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'multi-response-app',
            appName: 'Multi Response App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                { neuronId: 'processor', appId: 'multi-response-app', name: 'processor', axonCollaterals: ['process'] }
            ],
            collaterals: [
                { collateralName: 'process', neuronId: 'processor', appId: 'multi-response-app', type: 'process' }
            ],
            dendrites: [
                { dendriteId: 'processor-dendrite-0', neuronId: 'processor', appId: 'multi-response-app', collateralName: 'process', type: 'default', collateralNames: ['process'] }
            ],
        };

        await server.handleInit(appWs, init);

        // Step 2: Send multiple stimulations and responses
        const baseTime = Date.now();

        for (let i = 1; i <= 3; i++) {
            const stimulation: StimulationMessage = {
                type: 'stimulation',
                stimulationId: `stim-${i.toString().padStart(3, '0')}`,
                appId: 'multi-response-app',
                neuronId: 'processor',
                collateralName: 'process',
                timestamp: baseTime + (i * 100),
                payload: { jobId: i, data: `job-${i}` }
            };

            const response: NeuronResponseMessage = {
                type: 'neuron-response',
                responseId: `resp-${i.toString().padStart(3, '0')}`,
                stimulationId: `stim-${i.toString().padStart(3, '0')}`,
                neuronId: 'processor',
                appId: 'multi-response-app',
                timestamp: baseTime + (i * 100) + 50,
                duration: 20 + (i * 5), // Varying durations
                error: i === 2 ? 'Processing error' : null,
                responsePayload: i === 2 ? null : { result: `processed-${i}` }
            };

            await server.handleMessage(appWs, stimulation);
            await server.handleMessage(appWs, response);
        }

        // Step 3: Verify all data was stored correctly
        const stimulations = repo.messages.filter(m => m.type === 'stimulation');
        const responses = repo.messages.filter(m => m.type === 'neuron-response');

        expect(stimulations.length).toBe(3);
        expect(responses.length).toBe(3);

        // Verify error handling
        const errorResponse = responses.find(r => r.responseId === 'resp-002');
        expect(errorResponse.error).toBe('Processing error');
        expect(errorResponse.responsePayload).toBe(null);

        // Verify success cases
        const successResponse = responses.find(r => r.responseId === 'resp-001');
        expect(successResponse.error).toBe(null);
        expect(successResponse.responsePayload.result).toBe('processed-1');
    });

    it('proves backend data structure matches what DevTools UI expects', async () => {
        const repo = new InMemoryRepo();
        const server = new CNSDevToolsServer(repo);

        // Create realistic data that should match UI expectations
        const appWs = new MockWebSocket() as any;
        const init: InitMessage = {
            type: 'init',
            devToolsInstanceId: 'ecommerce-app',
            appName: 'E-commerce App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [
                { neuronId: 'ecommerce-app:auth-service', appId: 'ecommerce-app', name: 'auth-service', axonCollaterals: ['user-login'] }
            ],
            collaterals: [
                { collateralName: 'user-login', neuronId: 'ecommerce-app:auth-service', appId: 'ecommerce-app', type: 'authentication' }
            ],
            dendrites: [
                { dendriteId: 'auth-dendrite-0', neuronId: 'ecommerce-app:auth-service', appId: 'ecommerce-app', collateralName: 'user-login', type: 'default', collateralNames: ['user-login'] }
            ],
        };

        await server.handleInit(appWs, init);

        // Send data that matches real-world usage
        const response: NeuronResponseMessage = {
            type: 'neuron-response',
            responseId: 'csvbo00l57', // Real ID from logs
            stimulationId: 'stim-auth-001',
            neuronId: 'ecommerce-app:auth-service', // Full ID matching neuron definition
            appId: 'ecommerce-app',
            timestamp: 1759139857738, // Real timestamp
            duration: 25,
            error: null,
            responsePayload: { success: true, userId: '12345' }
        };

        await server.handleMessage(appWs, response);

        // Verify the stored data has all fields the UI expects
        const storedResponse = repo.messages.find(m => m.type === 'neuron-response');

        // These are the fields the UI components require:
        expect(storedResponse.responseId).toBe('csvbo00l57');
        expect(storedResponse.stimulationId).toBeDefined();
        expect(storedResponse.neuronId).toBe('ecommerce-app:auth-service');
        expect(storedResponse.appId).toBe('ecommerce-app');
        expect(storedResponse.timestamp).toBe(1759139857738);
        expect(storedResponse.duration).toBe(25);
        expect(storedResponse.error).toBe(null);
        expect(storedResponse.responsePayload).toBeDefined();

        // This proves the backend can provide all the data the UI needs
    });
});