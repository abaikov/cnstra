import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { CNS } from '@cnstra/core';
import { CNSDevTools } from '@cnstra/devtools';
import { db } from '../model';
import { CNSCollateral } from '@cnstra/core';

// Mock transport for testing
class MockDevToolsTransport {
    private messages: any[] = [];

    async sendInitMessage(message: any): Promise<void> {
        console.log('📤 Mock transport sending init:', message);
        this.messages.push(message);

        // Simulate adding data to the database
        await db.apps.upsertOne({
            appId: message.devToolsInstanceId,
            appName: message.appName,
            version: message.version,
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
        });

        // Add neurons to database
        for (const neuron of message.neurons) {
            await db.neurons.upsertOne({
                id: `${message.devToolsInstanceId}_${neuron.name}`,
                appId: message.devToolsInstanceId,
                name: neuron.name,
            });
        }

        // Add dendrites to database
        for (const dendrite of message.dendrites) {
            await db.dendrites.upsertOne({
                dendriteId: `${message.devToolsInstanceId}_${dendrite.neuronName}_${dendrite.collateralName}`,
                appId: message.devToolsInstanceId,
                neuronId: `${message.devToolsInstanceId}_${dendrite.neuronName}`,
                collateralName: dendrite.collateralName,
                type: 'input',
                collateralNames: [dendrite.collateralName],
            });
        }
    }

    async sendNeuronResponseMessage(message: any): Promise<void> {
        console.log('📤 Mock transport sending response:', message);
        this.messages.push(message);

        // Add response to database
        await db.responses.upsertOne({
            responseId: `${message.stimulationId}_${Date.now()}_${Math.random()}`,
            appId: message.appId,
            neuronId: message.neuronId || 'unknown',
            stimulationId: message.stimulationId,
            timestamp: message.timestamp,
            responsePayload: message.responsePayload,
            error: message.error,
        });
    }

    getMessages() {
        return this.messages;
    }

    clear() {
        this.messages = [];
    }
}

// Test CNS setup
function createTestCNS() {
    const cns = new CNS([
        {
            name: 'inputNeuron',
            axon: {
                userAction: {
                    name: 'userAction',
                    createSignal: (payload: { action: string }) => ({
                        collateral: { name: 'userAction' },
                        payload,
                    }),
                },
            },
            dendrites: [],
        },
        {
            name: 'processingNeuron',
            axon: {
                processedData: {
                    name: 'processedData',
                    createSignal: (payload: { result: any }) => ({
                        collateral: { name: 'processedData' },
                        payload,
                    }),
                },
            },
            dendrites: [
                {
                    collateral: new CNSCollateral('userAction'),
                    response: (payload: { action: string }, axon: any) => {
                        console.log('🧠 Processing neuron received:', payload);
                        return axon.processedData.createSignal({
                            result: `Processed: ${payload.action}`,
                        });
                    },
                },
            ],
        },
        {
            name: 'outputNeuron',
            axon: {
                finalOutput: {
                    name: 'finalOutput',
                    createSignal: (payload: { output: string }) => ({
                        collateral: { name: 'finalOutput' },
                        payload,
                    }),
                },
            },
            dendrites: [
                {
                    collateral: new CNSCollateral('processedData'),
                    response: (payload: { result: any }, axon: any) => {
                        console.log('🎯 Output neuron received:', payload);
                        return axon.finalOutput.createSignal({
                            output: `Final: ${payload.result}`,
                        });
                    },
                },
            ],
        },
    ]);

    return cns;
}

describe('CNS DevTools Simulation Tests', () => {
    let cns: CNS<any, any, any, any>;
    let transport: MockDevToolsTransport;
    let devTools: CNSDevTools;

    beforeEach(async () => {
        // Clear database
        await db.apps.clear();
        await db.neurons.clear();
        await db.dendrites.clear();
        await db.responses.clear();
        await db.stimulations.clear();

        // Create test CNS
        cns = createTestCNS();
        transport = new MockDevToolsTransport();

        // Initialize DevTools
        devTools = new CNSDevTools(cns, transport, {
            devToolsInstanceId: 'test-app',
            devToolsInstanceName: 'Test CNS App',
            takeDataSnapshot: () => ({}),
        });

        // Wait a bit for initialization
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(() => {
        transport.clear();
    });

    it('should initialize DevTools and populate database', async () => {
        // Check that app was added to database
        const apps = await db.apps.getAll();
        expect(apps).toHaveLength(1);
        expect(apps[0].appId).toBe('test-app');
        expect(apps[0].appName).toBe('Test CNS App');

        // Check that neurons were added
        const neurons = await db.neurons.getAll();
        expect(neurons.length).toBeGreaterThan(0);
        console.log('🧠 Neurons in DB:', neurons);

        // Check that dendrites were added
        const dendrites = await db.dendrites.getAll();
        expect(dendrites.length).toBeGreaterThan(0);
        console.log('🌿 Dendrites in DB:', dendrites);
    });

    it('should record stimulations and responses', async () => {
        // Perform a stimulation
        const signal = cns.getNeurons()[0].axon.userAction.createSignal({
            action: 'test-click',
        });

        await cns.stimulate(signal, {
            stimulationId: 'test-stimulation-1',
        });

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 200));

        // Check that responses were recorded
        const responses = await db.responses.getAll();
        expect(responses.length).toBeGreaterThan(0);
        console.log('⚡ Responses in DB:', responses);

        // Check that stimulation was recorded
        const stimulations = await db.stimulations.getAll();
        console.log('🎯 Stimulations in DB:', stimulations);
    });

    it('should handle multiple stimulations', async () => {
        const inputNeuron = cns
            .getNeurons()
            .find(n => n.name === 'inputNeuron');
        expect(inputNeuron).toBeDefined();

        // Perform multiple stimulations
        for (let i = 0; i < 5; i++) {
            const signal = inputNeuron!.axon.userAction.createSignal({
                action: `test-action-${i}`,
            });

            await cns.stimulate(signal, {
                stimulationId: `test-stimulation-${i}`,
            });

            // Small delay between stimulations
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Wait for all processing to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check that all responses were recorded
        const responses = await db.responses.getAll();
        expect(responses.length).toBeGreaterThan(5); // Should have responses from multiple neurons
        console.log('⚡ Multiple responses recorded:', responses.length);

        // Verify we have responses for different neurons
        const uniqueNeurons = new Set(
            responses.map(r => r.neuronId)
        );
        expect(uniqueNeurons.size).toBeGreaterThan(1);
        console.log('🧠 Unique active collaterals:', Array.from(uniqueNeurons));
    });

    it('should create graph data from real CNS data', async () => {
        // Perform some stimulations first
        const inputNeuron = cns
            .getNeurons()
            .find(n => n.name === 'inputNeuron');

        for (let i = 0; i < 3; i++) {
            const signal = inputNeuron!.axon.userAction.createSignal({
                action: `graph-test-${i}`,
            });

            await cns.stimulate(signal, {
                stimulationId: `graph-test-${i}`,
            });
        }

        await new Promise(resolve => setTimeout(resolve, 300));

        // Get data from database (simulate what the UI does)
        const apps = await db.apps.getAll();
        const neurons = await db.neurons.getAll();
        const dendrites = await db.dendrites.getAll();
        const responses = await db.responses.getAll();

        console.log('📊 Graph data check:');
        console.log('  Apps:', apps.length);
        console.log('  Neurons:', neurons.length);
        console.log('  Dendrites:', dendrites.length);
        console.log('  Responses:', responses.length);

        // Verify we have the data needed for graph
        expect(apps.length).toBe(1);
        expect(neurons.length).toBeGreaterThan(0);
        expect(responses.length).toBeGreaterThan(0);

        // Test the conversion logic (copy from App.tsx)
        const graphNeurons = neurons.map((neuron, index) => {
            const stimulationCount = responses.length; // Simple count for test

            return {
                id: neuron.id,
                name: neuron.name,
                x: 100 + (index % 8) * 80,
                y: 100 + Math.floor(index / 8) * 80,
                stimulationCount,
                stimulations: responses.slice(0, 10).map(response => ({
                    id: response.responseId,
                    timestamp: response.timestamp,
                    signal: { type: 'test', intensity: 0.5 },
                    targetNeuron: neuron.id,
                })),
                type: (index === 0 ? 'input' : 'processing') as
                    | 'input'
                    | 'processing'
                    | 'output',
            };
        });

        expect(graphNeurons.length).toBeGreaterThan(0);
        expect(graphNeurons[0].stimulationCount).toBeGreaterThan(0);

        console.log(
            '✅ Graph conversion successful:',
            graphNeurons.length,
            'neurons'
        );
        console.log('🎯 Sample graph neuron:', graphNeurons[0]);
    });

    it('should handle concurrent stimulations', async () => {
        const inputNeuron = cns
            .getNeurons()
            .find(n => n.name === 'inputNeuron');

        // Fire multiple concurrent stimulations
        const stimulationPromises = [];
        for (let i = 0; i < 10; i++) {
            const signal = inputNeuron!.axon.userAction.createSignal({
                action: `concurrent-${i}`,
            });

            stimulationPromises.push(
                cns.stimulate(signal, {
                    stimulationId: `concurrent-${i}`,
                    concurrency: 5, // Allow concurrent processing
                })
            );
        }

        // Wait for all to complete
        await Promise.all(stimulationPromises);
        await new Promise(resolve => setTimeout(resolve, 500));

        const responses = await db.responses.getAll();
        expect(responses.length).toBeGreaterThan(10);
        console.log('🚀 Concurrent stimulations processed:', responses.length);
    });

    it('should track neuron activity over time', async () => {
        const inputNeuron = cns
            .getNeurons()
            .find(n => n.name === 'inputNeuron');
        const startTime = Date.now();

        // Simulate activity over time
        for (let wave = 0; wave < 3; wave++) {
            console.log(`🌊 Wave ${wave + 1} of stimulations`);

            for (let i = 0; i < 5; i++) {
                const signal = inputNeuron!.axon.userAction.createSignal({
                    action: `wave-${wave}-action-${i}`,
                    timestamp: Date.now(),
                });

                await cns.stimulate(signal, {
                    stimulationId: `wave-${wave}-${i}`,
                });
            }

            // Wait between waves
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await new Promise(resolve => setTimeout(resolve, 300));

        const responses = await db.responses.getAll();
        const endTime = Date.now();

        console.log('📈 Activity tracking results:');
        console.log(`  Total responses: ${responses.length}`);
        console.log(`  Time span: ${endTime - startTime}ms`);
        console.log(
            `  Average response time: ${
                (endTime - startTime) / responses.length
            }ms`
        );

        // Verify temporal distribution
        const timeDistribution = responses.reduce((acc, response) => {
            const timeSlot = Math.floor((response.timestamp - startTime) / 100);
            acc[timeSlot] = (acc[timeSlot] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);

        console.log('⏰ Time distribution:', timeDistribution);
        expect(Object.keys(timeDistribution).length).toBeGreaterThan(1);
    });
});

describe('DevTools UI Data Integration', () => {
    let mockData: {
        apps: any[];
        neurons: any[];
        dendrites: any[];
        responses: any[];
    };

    beforeEach(async () => {
        // Clear database
        await db.apps.clear();
        await db.neurons.clear();
        await db.dendrites.clear();
        await db.responses.clear();

        // Create mock data that simulates real CNS data
        mockData = {
            apps: [
                {
                    appId: 'test-ecommerce',
                    appName: 'Test E-commerce App',
                    version: '1.0.0',
                    firstSeenAt: Date.now() - 10000,
                    lastSeenAt: Date.now(),
                },
            ],
            neurons: [
                {
                    id: 'test-ecommerce_userInput',
                    appId: 'test-ecommerce',
                    name: 'userInput',
                },
                {
                    id: 'test-ecommerce_cartProcessor',
                    appId: 'test-ecommerce',
                    name: 'cartProcessor',
                },
                {
                    id: 'test-ecommerce_paymentHandler',
                    appId: 'test-ecommerce',
                    name: 'paymentHandler',
                },
                {
                    id: 'test-ecommerce_orderConfirmation',
                    appId: 'test-ecommerce',
                    name: 'orderConfirmation',
                },
            ],
            dendrites: [
                {
                    id: 'test-ecommerce_cartProcessor_userAction',
                    appId: 'test-ecommerce',
                    neuronId: 'test-ecommerce_cartProcessor',
                    collateralName: 'userAction',
                },
                {
                    id: 'test-ecommerce_paymentHandler_cartUpdated',
                    appId: 'test-ecommerce',
                    neuronId: 'test-ecommerce_paymentHandler',
                    collateralName: 'cartUpdated',
                },
                {
                    id: 'test-ecommerce_orderConfirmation_paymentProcessed',
                    appId: 'test-ecommerce',
                    neuronId: 'test-ecommerce_orderConfirmation',
                    collateralName: 'paymentProcessed',
                },
            ],
            responses: [],
        };

        // Populate database
        for (const app of mockData.apps) {
            await db.apps.upsertOne(app);
        }
        for (const neuron of mockData.neurons) {
            await db.neurons.upsertOne(neuron);
        }
        for (const dendrite of mockData.dendrites) {
            await db.dendrites.upsertOne(dendrite);
        }
    });

    it('should convert database data to graph format', async () => {
        // Add some mock responses
        const mockResponses = [
            {
                responseId: 'resp_1',
                neuronId: 'test-ecommerce_userInput',
                appId: 'test-ecommerce',
                stimulationId: 'stim_1',
                timestamp: Date.now() - 5000,
            },
            {
                responseId: 'resp_2',
                neuronId: 'test-ecommerce_cartProcessor',
                appId: 'test-ecommerce',
                stimulationId: 'stim_1',
                timestamp: Date.now() - 4000,
            },
            {
                responseId: 'resp_3',
                neuronId: 'test-ecommerce_paymentHandler',
                appId: 'test-ecommerce',
                stimulationId: 'stim_1',
                timestamp: Date.now() - 3000,
            },
        ];

        for (const response of mockResponses) {
            await db.responses.upsertOne(response);
        }

        // Get data from database
        const apps = await db.apps.getAll();
        const neurons = await db.neurons.getAll();
        const dendrites = await db.dendrites.getAll();
        const responses = await db.responses.getAll();

        console.log('📊 Database state:');
        console.log('  Apps:', apps.length);
        console.log('  Neurons:', neurons.length);
        console.log('  Dendrites:', dendrites.length);
        console.log('  Responses:', responses.length);

        // Test conversion logic (simplified version of App.tsx logic)
        const graphNeurons = neurons.map((neuron, index) => ({
            id: neuron.id,
            name: neuron.name,
            x: 100 + index * 100,
            y: 200,
            stimulationCount: responses.length, // Simple count
            stimulations: responses.map(response => ({
                id: response.responseId,
                timestamp: response.timestamp,
                signal: { type: 'test', intensity: 0.5 },
                targetNeuron: neuron.id,
            })),
            type: (index === 0 ? 'input' : 'processing') as
                | 'input'
                | 'processing'
                | 'output',
        }));

        expect(graphNeurons.length).toBe(4);
        expect(graphNeurons[0].stimulationCount).toBe(3);
        expect(graphNeurons[0].name).toBe('userInput');

        console.log('✅ Graph conversion test passed');
        console.log('🎯 Sample graph neuron:', graphNeurons[0]);
    });

    it('should handle real-time updates', async () => {
        // Start with empty responses
        let responses = await db.responses.getAll();
        expect(responses.length).toBe(0);

        // Add responses over time
        for (let i = 0; i < 5; i++) {
            await db.responses.upsertOne({
                responseId: `realtime_${i}`,
                neuronId: 'test-ecommerce_userInput',
                appId: 'test-ecommerce',
                stimulationId: `realtime_stim_${i}`,
                timestamp: Date.now(),
            });

            // Check that data is updated
            responses = await db.responses.getAll();
            expect(responses.length).toBe(i + 1);

            console.log(
                `📈 Real-time update ${i + 1}: ${responses.length} responses`
            );
        }

        console.log('✅ Real-time updates working correctly');
    });

    it('should simulate e-commerce workflow', async () => {
        console.log('🛒 Simulating e-commerce workflow...');

        // Simulate user journey: browse → add to cart → checkout → payment
        const workflow = [
            { action: 'browse_products', collateral: 'userAction' },
            { action: 'add_to_cart', collateral: 'userAction' },
            { action: 'view_cart', collateral: 'cartUpdated' },
            { action: 'checkout', collateral: 'cartUpdated' },
            { action: 'payment', collateral: 'paymentProcessed' },
            { action: 'confirm_order', collateral: 'paymentProcessed' },
        ];

        for (let index = 0; index < workflow.length; index++) {
            const step = workflow[index];
            await db.responses.upsertOne({
                responseId: `workflow_${index}`,
                neuronId: 'test-ecommerce_userInput',
                appId: 'test-ecommerce',
                stimulationId: `workflow_stim_${index}`,
                timestamp: Date.now() + index * 1000, // Spread over time
                responsePayload: { action: step.action },
            });

            console.log(
                `🛒 Step ${index + 1}: ${step.action} → ${step.collateral}`
            );
        }

        // Verify workflow was recorded
        const responses = await db.responses.getAll();
        expect(responses.length).toBe(6);

        // Check activity distribution
        const neuronActivity = responses.reduce((acc, response) => {
            const neuron = response.neuronId || 'unknown';
            acc[neuron] = (acc[neuron] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        console.log('📊 Activity by neuron:', neuronActivity);
        expect(Object.keys(neuronActivity).length).toBeGreaterThan(0);

        // Test graph neuron creation with this data
        const neurons = await db.neurons.getAll();
        const graphNeurons = neurons.map((neuron, index) => {
            const neuronActivity = responses.filter(
                r => r.neuronId === neuron.id
            ).length;

            return {
                id: neuron.id,
                name: neuron.name,
                x: 100 + index * 120,
                y: 200,
                stimulationCount: neuronActivity,
                type: index === 0 ? 'input' : 'processing',
            };
        });

        console.log('🧠 E-commerce graph neurons:', graphNeurons);
        expect(graphNeurons.some(n => n.stimulationCount > 0)).toBe(true);
    });
});
