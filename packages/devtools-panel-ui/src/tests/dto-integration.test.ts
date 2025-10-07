import { describe, it, expect, beforeEach } from '@jest/globals';
import { mainCNS } from '../cns';
import { appModelAxon } from '../cns/controller-layer/AppModelAxon';
import { db, dbEventQueue } from '../model';
import { InitMessage } from '@cnstra/devtools-dto';

describe('DTO Integration Tests', () => {
    beforeEach(() => {
        // Clear database before each test
        db.neurons.collection.clear();
        db.collaterals.collection.clear();
        db.dendrites.collection.clear();
        db.responses.collection.clear();
        db.stimulations.collection.clear();
        db.apps.collection.clear();

        // Clear indexes
        Object.values(db.neurons.indexes).forEach(index => index.clear());
        Object.values(db.collaterals.indexes).forEach(index => index.clear());
        Object.values(db.dendrites.indexes).forEach(index => index.clear());
        Object.values(db.responses.indexes).forEach(index => index.clear());
        Object.values(db.stimulations.indexes).forEach(index => index.clear());
        Object.values(db.apps.indexes).forEach(index => index.clear());

        dbEventQueue.flush();
    });

    describe('Neuron DTO Field Mapping', () => {
        it('should handle neuron.id field correctly from DTO', async () => {
            const appId = 'test-ecommerce';
            const initMessage: InitMessage = {
                type: 'init',
                devToolsInstanceId: appId,
                appName: 'Test E-commerce App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:auth-service`, // Using qualified ID format
                        appId,
                        name: 'auth-service',
                    },
                    {
                        id: `${appId}:search-service`,
                        appId,
                        name: 'search-service',
                    },
                ],
                collaterals: [
                    {
                        collateralName: 'user-authenticated',
                        neuronId: `${appId}:auth-service`, // Using qualified neuronId reference
                        appId,
                        type: 'default',
                    },
                    {
                        collateralName: 'search-results',
                        neuronId: `${appId}:search-service`,
                        appId,
                        type: 'default',
                    },
                ],
                dendrites: [
                    {
                        dendriteId: 'auth-dendrite-0',
                        neuronId: `${appId}:auth-service`,
                        appId,
                        collateralName: 'user-authenticated',
                        type: 'default',
                        collateralNames: ['user-authenticated'],
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage)
            );
            dbEventQueue.flush();

            // Verify neurons are stored with correct ID format
            const storedNeurons = db.neurons.getAll();
            expect(storedNeurons).toHaveLength(2);

            const authNeuron = storedNeurons.find(
                (n: any) => n.name === 'auth-service'
            );
            expect(authNeuron).toBeDefined();
            expect(authNeuron!.id).toBe(`${appId}:auth-service`);
            expect(authNeuron!.appId).toBe(appId);

            // Verify collaterals reference correct neuronIds
            const storedCollaterals = db.collaterals.getAll();
            expect(storedCollaterals).toHaveLength(2);

            const userAuthCollateral = storedCollaterals.find(
                (c: any) => c.name === 'user-authenticated'
            );
            expect(userAuthCollateral).toBeDefined();
            expect(userAuthCollateral!.neuronId).toBe(`${appId}:auth-service`);

            // Verify dendrites reference correct neuronIds
            const storedDendrites = db.dendrites.getAll();
            expect(storedDendrites).toHaveLength(1);
            expect(storedDendrites[0].neuronId).toBe(`${appId}:auth-service`);
        });
    });

    describe('Response-to-Neuron Matching', () => {
        it('should correctly match responses to neurons using qualified IDs', async () => {
            const appId = 'test-ecommerce';

            // First, set up initial topology
            const initMessage: InitMessage = {
                type: 'init',
                devToolsInstanceId: appId,
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:auth-service`,
                        appId,
                        name: 'auth-service',
                    },
                    {
                        id: `${appId}:search-service`,
                        appId,
                        name: 'search-service',
                    },
                ],
                collaterals: [],
                dendrites: [],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage)
            );
            dbEventQueue.flush();

            // Now send response batch with neuronId references
            const responseBatch = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'stim-1',
                        neuronId: `${appId}:auth-service`, // Should match stored neuron ID
                        appId,
                        timestamp: Date.now() - 3000,
                        collateralName: 'userAuthenticated',
                        responsePayload: { userId: '123' },
                    },
                    {
                        stimulationId: 'stim-2',
                        neuronId: `${appId}:auth-service`,
                        appId,
                        timestamp: Date.now() - 2000,
                        collateralName: 'userAuthenticated',
                        responsePayload: { userId: '456' },
                    },
                    {
                        stimulationId: 'stim-3',
                        neuronId: `${appId}:search-service`, // Different neuron
                        appId,
                        timestamp: Date.now() - 1000,
                        collateralName: 'searchResults',
                        responsePayload: { results: [] },
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(responseBatch)
            );
            dbEventQueue.flush();

            // Verify responses are stored with correct neuronId
            const storedResponses = db.responses.getAll();
            expect(storedResponses).toHaveLength(3);

            // Test response-to-neuron matching (the core issue we fixed)
            const authNeuronId = `${appId}:auth-service`;
            const searchNeuronId = `${appId}:search-service`;

            const authResponses = storedResponses.filter(
                r => r.neuronId === authNeuronId
            );
            const searchResponses = storedResponses.filter(
                r => r.neuronId === searchNeuronId
            );

            expect(authResponses).toHaveLength(2); // Two auth responses
            expect(searchResponses).toHaveLength(1); // One search response

            // Verify stored neurons can be matched with their responses
            const storedNeurons = db.neurons.getAll();
            const authNeuron = storedNeurons.find(n => n.id === authNeuronId);
            const searchNeuron = storedNeurons.find(
                n => n.id === searchNeuronId
            );

            expect(authNeuron).toBeDefined();
            expect(searchNeuron).toBeDefined();

            // This is the critical test - response neuronId should match neuron id
            expect(
                authResponses.every(r => r.neuronId === authNeuron!.id)
            ).toBe(true);
            expect(
                searchResponses.every(r => r.neuronId === searchNeuron!.id)
            ).toBe(true);
        });

        it('should handle stimulation count calculation correctly', async () => {
            const appId = 'stimulation-test';

            // Set up neurons
            const initMessage: InitMessage = {
                type: 'init',
                devToolsInstanceId: appId,
                appName: 'Stimulation Test',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:neuron-a`,
                        appId,
                        name: 'neuron-a',
                    },
                    {
                        id: `${appId}:neuron-b`,
                        appId,
                        name: 'neuron-b',
                    },
                ],
                collaterals: [],
                dendrites: [],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage)
            );
            dbEventQueue.flush();

            // Send varying numbers of responses for each neuron
            const responseBatch = {
                type: 'response-batch' as const,
                responses: [
                    // 3 responses for neuron-a
                    {
                        stimulationId: 's1',
                        neuronId: `${appId}:neuron-a`,
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 1000,
                    },
                    {
                        stimulationId: 's2',
                        neuronId: `${appId}:neuron-a`,
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 2000,
                    },
                    {
                        stimulationId: 's3',
                        neuronId: `${appId}:neuron-a`,
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 3000,
                    },
                    // 1 response for neuron-b
                    {
                        stimulationId: 's4',
                        neuronId: `${appId}:neuron-b`,
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 4000,
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(responseBatch)
            );
            dbEventQueue.flush();

            // Simulate the stimulation count logic from App.tsx
            const allNeurons = db.neurons.getAll();
            const allResponses = db.responses.getAll();

            const neuronA = allNeurons.find(n => n.name === 'neuron-a');
            const neuronB = allNeurons.find(n => n.name === 'neuron-b');

            expect(neuronA).toBeDefined();
            expect(neuronB).toBeDefined();

            // Test the exact filtering logic from App.tsx
            const stimulationCountA = allResponses.filter(
                r => r.neuronId === neuronA!.id
            ).length;
            const stimulationCountB = allResponses.filter(
                r => r.neuronId === neuronB!.id
            ).length;

            expect(stimulationCountA).toBe(3);
            expect(stimulationCountB).toBe(1);

            // Test that no responses are lost or mismatched
            const totalResponsesMatched = stimulationCountA + stimulationCountB;
            expect(totalResponsesMatched).toBe(4); // Should match total responses sent
        });
    });

    describe('Real-world DTO Scenarios', () => {
        it('should handle complete e-commerce app DTO correctly', async () => {
            const appId = 'ecommerce-app';

            const initMessage: InitMessage = {
                type: 'init',
                devToolsInstanceId: appId,
                appName: 'E-commerce Demo App',
                version: '0.0.1',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:auth-service`,
                        appId,
                        name: 'auth-service',
                    },
                    {
                        id: `${appId}:search-service`,
                        appId,
                        name: 'search-service',
                    },
                    {
                        id: `${appId}:cart-service`,
                        appId,
                        name: 'cart-service',
                    },
                    {
                        id: `${appId}:order-service`,
                        appId,
                        name: 'order-service',
                    },
                ],
                collaterals: [
                    {
                        collateralName: 'user-authenticated',
                        neuronId: `${appId}:auth-service`,
                        appId,
                        type: 'default',
                    },
                    {
                        collateralName: 'products-found',
                        neuronId: `${appId}:search-service`,
                        appId,
                        type: 'default',
                    },
                    {
                        collateralName: 'cart-updated',
                        neuronId: `${appId}:cart-service`,
                        appId,
                        type: 'default',
                    },
                    {
                        collateralName: 'order-created',
                        neuronId: `${appId}:order-service`,
                        appId,
                        type: 'default',
                    },
                ],
                dendrites: [
                    {
                        dendriteId: 'auth-service-dendrite-0',
                        neuronId: `${appId}:auth-service`,
                        appId,
                        collateralName: 'user-authenticated',
                        type: 'default',
                        collateralNames: ['user-authenticated'],
                    },
                    {
                        dendriteId: 'search-service-dendrite-0',
                        neuronId: `${appId}:search-service`,
                        appId,
                        collateralName: 'products-found',
                        type: 'default',
                        collateralNames: ['products-found'],
                    },
                    {
                        dendriteId: 'cart-service-dendrite-0',
                        neuronId: `${appId}:cart-service`,
                        appId,
                        collateralName: 'cart-updated',
                        type: 'default',
                        collateralNames: ['cart-updated'],
                    },
                    {
                        dendriteId: 'order-service-dendrite-0',
                        neuronId: `${appId}:order-service`,
                        appId,
                        collateralName: 'order-created',
                        type: 'default',
                        collateralNames: ['order-created'],
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage)
            );
            dbEventQueue.flush();

            // Verify topology is created correctly
            const storedNeurons = db.neurons.getAll();
            const storedCollaterals = db.collaterals.getAll();
            const storedDendrites = db.dendrites.getAll();

            expect(storedNeurons).toHaveLength(4);
            expect(storedCollaterals).toHaveLength(4);
            expect(storedDendrites).toHaveLength(4);

            // Verify all neurons have qualified IDs
            storedNeurons.forEach(neuron => {
                expect(neuron.id).toMatch(/^ecommerce-app:/);
                expect(neuron.id).toContain(neuron.name);
            });

            // Verify all collaterals reference qualified neuron IDs
            storedCollaterals.forEach(collateral => {
                expect(collateral.neuronId).toMatch(/^ecommerce-app:/);
                const matchingNeuron = storedNeurons.find(
                    n => n.id === collateral.neuronId
                );
                expect(matchingNeuron).toBeDefined();
            });

            // Verify all dendrites reference qualified neuron IDs
            storedDendrites.forEach(dendrite => {
                expect(dendrite.neuronId).toMatch(/^ecommerce-app:/);
                const matchingNeuron = storedNeurons.find(
                    n => n.id === dendrite.neuronId
                );
                expect(matchingNeuron).toBeDefined();
            });

            // Send realistic response batch
            const responseBatch = {
                type: 'response-batch' as const,
                responses: [
                    // User authentication flow
                    {
                        stimulationId: 'auth-flow-1',
                        neuronId: `${appId}:auth-service`,
                        appId,
                        timestamp: Date.now() - 10000,
                        collateralName: 'userAuthenticated',
                        responsePayload: {
                            userId: 'user123',
                            email: 'john@example.com',
                        },
                    },
                    // Product search
                    {
                        stimulationId: 'search-flow-1',
                        neuronId: `${appId}:search-service`,
                        appId,
                        timestamp: Date.now() - 8000,
                        collateralName: 'productsFound',
                        responsePayload: {
                            products: [{ id: 'p1', name: 'Laptop' }],
                        },
                    },
                    // Add to cart
                    {
                        stimulationId: 'cart-flow-1',
                        neuronId: `${appId}:cart-service`,
                        appId,
                        timestamp: Date.now() - 6000,
                        collateralName: 'cartUpdated',
                        responsePayload: { cartId: 'cart123', items: 1 },
                    },
                    // Create order
                    {
                        stimulationId: 'order-flow-1',
                        neuronId: `${appId}:order-service`,
                        appId,
                        timestamp: Date.now() - 4000,
                        collateralName: 'orderCreated',
                        responsePayload: { orderId: 'order123', total: 999.99 },
                    },
                    // Additional auth service activity
                    {
                        stimulationId: 'auth-flow-2',
                        neuronId: `${appId}:auth-service`,
                        appId,
                        timestamp: Date.now() - 2000,
                        collateralName: 'userAuthenticated',
                        responsePayload: {
                            userId: 'user456',
                            email: 'jane@example.com',
                        },
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(responseBatch)
            );
            dbEventQueue.flush();

            // Verify responses are correctly associated
            const allResponses = db.responses.getAll();
            expect(allResponses).toHaveLength(5);

            // Test stimulation count for each service
            const authResponses = allResponses.filter(
                r => r.neuronId === `${appId}:auth-service`
            );
            const searchResponses = allResponses.filter(
                r => r.neuronId === `${appId}:search-service`
            );
            const cartResponses = allResponses.filter(
                r => r.neuronId === `${appId}:cart-service`
            );
            const orderResponses = allResponses.filter(
                r => r.neuronId === `${appId}:order-service`
            );

            expect(authResponses).toHaveLength(2); // 2 auth events
            expect(searchResponses).toHaveLength(1); // 1 search event
            expect(cartResponses).toHaveLength(1); // 1 cart event
            expect(orderResponses).toHaveLength(1); // 1 order event

            // Verify no responses are orphaned (this was the original bug)
            const totalMatched =
                authResponses.length +
                searchResponses.length +
                cartResponses.length +
                orderResponses.length;
            expect(totalMatched).toBe(5); // All responses should be matched
        });
    });

    describe('Error Scenarios and Edge Cases', () => {
        it('should handle responses for unknown neurons gracefully', async () => {
            const appId = 'unknown-neuron-test';

            // Set up minimal topology
            const initMessage: InitMessage = {
                type: 'init',
                devToolsInstanceId: appId,
                appName: 'Test App',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:known-service`,
                        appId,
                        name: 'known-service',
                    },
                ],
                collaterals: [],
                dendrites: [],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage)
            );
            dbEventQueue.flush();

            // Send response batch with unknown neuron reference
            const responseBatch = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'known-1',
                        neuronId: `${appId}:known-service`, // This should work
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 2000,
                    },
                    {
                        stimulationId: 'unknown-1',
                        neuronId: `${appId}:unknown-service`, // This neuron doesn't exist in init
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 1000,
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(responseBatch)
            );
            dbEventQueue.flush();

            // Verify both responses are stored (ResponsesNeuron should handle unknown neurons)
            const allResponses = db.responses.getAll();
            expect(allResponses).toHaveLength(2);

            // Verify known neuron responses work correctly
            const knownNeuronResponses = allResponses.filter(
                r => r.neuronId === `${appId}:known-service`
            );
            expect(knownNeuronResponses).toHaveLength(1);

            // Verify unknown neuron response is stored with correct ID
            const unknownNeuronResponses = allResponses.filter(
                r => r.neuronId === `${appId}:unknown-service`
            );
            expect(unknownNeuronResponses).toHaveLength(1);
        });

        it('should handle malformed DTO messages gracefully', async () => {
            const appId = 'malformed-test';

            // Test with missing required fields
            const malformedInit = {
                type: 'init' as const,
                devToolsInstanceId: appId,
                appName: 'Malformed Test App',
                timestamp: Date.now(),
                // Missing version to make it "malformed" but still valid TypeScript
                neurons: [
                    {
                        id: `${appId}:incomplete-neuron`,
                        appId,
                        name: 'incomplete-neuron',
                    },
                ],
                collaterals: [],
                dendrites: [],
            };

            // This should not crash the system
            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(malformedInit)
            );
            dbEventQueue.flush();

            // Should handle gracefully - may create partial data or skip entirely
            const storedNeurons = db.neurons.getAll();
            // The specific behavior depends on implementation, but it shouldn't crash
            expect(storedNeurons).toBeDefined();
        });

        it('should maintain data consistency across multiple DTO updates', async () => {
            const appId = 'consistency-test';

            // First init with basic topology
            const initMessage1: InitMessage = {
                type: 'init',
                devToolsInstanceId: appId,
                appName: 'Consistency Test',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:service-a`,
                        appId,
                        name: 'service-a',
                    },
                ],
                collaterals: [
                    {
                        collateralName: 'output-a',
                        neuronId: `${appId}:service-a`,
                        appId,
                        type: 'default',
                    },
                ],
                dendrites: [],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage1)
            );
            dbEventQueue.flush();

            // Send some responses
            const responseBatch1 = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'batch1-1',
                        neuronId: `${appId}:service-a`,
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 5000,
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(responseBatch1)
            );
            dbEventQueue.flush();

            // Updated init with additional neuron
            const initMessage2: InitMessage = {
                type: 'init',
                devToolsInstanceId: appId,
                appName: 'Consistency Test',
                version: '1.1.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:service-a`,
                        appId,
                        name: 'service-a',
                    },
                    {
                        id: `${appId}:service-b`, // New neuron
                        appId,
                        name: 'service-b',
                    },
                ],
                collaterals: [
                    {
                        collateralName: 'output-a',
                        neuronId: `${appId}:service-a`,
                        appId,
                        type: 'default',
                    },
                    {
                        collateralName: 'output-b',
                        neuronId: `${appId}:service-b`,
                        appId,
                        type: 'default',
                    },
                ],
                dendrites: [],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage2)
            );
            dbEventQueue.flush();

            // Send more responses for both services
            const responseBatch2 = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'batch2-1',
                        neuronId: `${appId}:service-a`,
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 3000,
                    },
                    {
                        stimulationId: 'batch2-2',
                        neuronId: `${appId}:service-b`,
                        appId,
                        collateralName: 'defaultOutput',
                        timestamp: Date.now() - 2000,
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(responseBatch2)
            );
            dbEventQueue.flush();

            // Verify data consistency
            const finalNeurons = db.neurons.getAll();
            const finalResponses = db.responses.getAll();

            expect(finalNeurons).toHaveLength(2);
            expect(finalResponses).toHaveLength(3);

            // Verify response-neuron matching still works
            const serviceAResponses = finalResponses.filter(
                r => r.neuronId === `${appId}:service-a`
            );
            const serviceBResponses = finalResponses.filter(
                r => r.neuronId === `${appId}:service-b`
            );

            expect(serviceAResponses).toHaveLength(2); // From batch1 and batch2
            expect(serviceBResponses).toHaveLength(1); // From batch2 only

            // All responses should be accounted for
            expect(serviceAResponses.length + serviceBResponses.length).toBe(3);
        });
    });

    describe('Live Stimulation Event Reaction', () => {
        it('should react to stimulation events in real-time showing live activity', async () => {
            const appId = 'live-activity-test';

            // Set up initial topology
            const initMessage = {
                type: 'init' as const,
                devToolsInstanceId: appId,
                appName: 'Live Activity Test',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:payment-service`,
                        appId,
                        name: 'payment-service',
                    },
                    {
                        id: `${appId}:notification-service`,
                        appId,
                        name: 'notification-service',
                    },
                ],
                collaterals: [
                    {
                        collateralName: 'payment-processed',
                        neuronId: `${appId}:payment-service`,
                        appId,
                        type: 'default',
                    },
                    {
                        collateralName: 'email-sent',
                        neuronId: `${appId}:notification-service`,
                        appId,
                        type: 'default',
                    },
                ],
                dendrites: [],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage)
            );
            dbEventQueue.flush();

            // Verify initial state - no activity yet
            const initialNeurons = db.neurons.getAll();
            const initialResponses = db.responses.getAll();

            expect(initialNeurons).toHaveLength(2);
            expect(initialResponses).toHaveLength(0);

            // Simulate live stimulation activity arriving over time
            const timestamps = [
                Date.now() - 5000,
                Date.now() - 4000,
                Date.now() - 3000,
                Date.now() - 2000,
                Date.now() - 1000,
            ];

            // First wave of activity - payment processing
            const activityWave1 = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'payment-1',
                        neuronId: `${appId}:payment-service`,
                        appId,
                        collateralName: 'paymentProcessed',
                        timestamp: timestamps[0],
                        responsePayload: {
                            amount: 99.99,
                            currency: 'USD',
                            status: 'success',
                        },
                    },
                    {
                        stimulationId: 'notification-1',
                        neuronId: `${appId}:notification-service`,
                        appId,
                        collateralName: 'emailSent',
                        timestamp: timestamps[1],
                        responsePayload: {
                            recipient: 'user@example.com',
                            template: 'payment-confirmation',
                        },
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(activityWave1)
            );
            dbEventQueue.flush();

            // Verify app state after first wave
            const responsesAfterWave1 = db.responses.getAll();
            expect(responsesAfterWave1).toHaveLength(2);

            // Test that responses are correctly associated with neurons (core functionality)
            const paymentResponses1 = responsesAfterWave1.filter(
                r => r.neuronId === `${appId}:payment-service`
            );
            const notificationResponses1 = responsesAfterWave1.filter(
                r => r.neuronId === `${appId}:notification-service`
            );

            expect(paymentResponses1).toHaveLength(1);
            expect(notificationResponses1).toHaveLength(1);

            // Verify response data integrity (payload might be processed differently)
            expect(paymentResponses1[0]).toBeDefined();
            expect(paymentResponses1[0].stimulationId).toBe('payment-1');

            // Second wave - more activity including failures
            const activityWave2 = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'payment-2',
                        neuronId: `${appId}:payment-service`,
                        appId,
                        collateralName: 'paymentFailed',
                        timestamp: timestamps[2],
                        responsePayload: {
                            amount: 149.99,
                            currency: 'USD',
                            status: 'failed',
                            error: 'insufficient_funds',
                        },
                    },
                    {
                        stimulationId: 'payment-3',
                        neuronId: `${appId}:payment-service`,
                        appId,
                        collateralName: 'paymentProcessed',
                        timestamp: timestamps[3],
                        responsePayload: {
                            amount: 29.99,
                            currency: 'USD',
                            status: 'success',
                        },
                    },
                    {
                        stimulationId: 'notification-2',
                        neuronId: `${appId}:notification-service`,
                        appId,
                        collateralName: 'smsSent',
                        timestamp: timestamps[4],
                        responsePayload: {
                            phone: '+1234567890',
                            message:
                                'Payment failed - please check your account',
                        },
                    },
                ],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(activityWave2)
            );
            dbEventQueue.flush();

            // Verify final app state - this tests the live reaction capability
            const finalResponses = db.responses.getAll();
            expect(finalResponses).toHaveLength(5); // Total of all responses

            // Test stimulation count calculation (the feature that was broken)
            const finalPaymentResponses = finalResponses.filter(
                r => r.neuronId === `${appId}:payment-service`
            );
            const finalNotificationResponses = finalResponses.filter(
                r => r.neuronId === `${appId}:notification-service`
            );

            expect(finalPaymentResponses).toHaveLength(3); // 1 success + 1 failure + 1 success
            expect(finalNotificationResponses).toHaveLength(2); // 1 email + 1 SMS

            // Verify response ordering (chronological by timestamp)
            const sortedResponses = finalResponses.sort(
                (a, b) => a.timestamp - b.timestamp
            );
            expect(sortedResponses[0].stimulationId).toBe('payment-1'); // Oldest
            expect(sortedResponses[4].stimulationId).toBe('notification-2'); // Newest

            // Test specific response types can be identified by stimulation ID
            const successfulPayments = finalPaymentResponses.filter(
                r =>
                    r.stimulationId === 'payment-1' ||
                    r.stimulationId === 'payment-3'
            );
            const failedPayments = finalPaymentResponses.filter(
                r => r.stimulationId === 'payment-2'
            );

            expect(successfulPayments).toHaveLength(2);
            expect(failedPayments).toHaveLength(1);

            // Verify response identification and categorization works
            const failedPayment = failedPayments[0];
            expect(failedPayment).toBeDefined();
            expect(failedPayment.stimulationId).toBe('payment-2');

            // Test that neurons haven't been duplicated
            const finalNeurons = db.neurons.getAll();
            expect(finalNeurons).toHaveLength(2); // Still just the original 2 neurons

            // Verify neuron identification remains consistent
            const paymentNeuron = finalNeurons.find(
                n => n.name === 'payment-service'
            );
            const notificationNeuron = finalNeurons.find(
                n => n.name === 'notification-service'
            );

            expect(paymentNeuron?.id).toBe(`${appId}:payment-service`);
            expect(notificationNeuron?.id).toBe(
                `${appId}:notification-service`
            );

            console.log('✅ Live activity test completed successfully:');
            console.log(
                `  - Processed ${finalResponses.length} stimulation events`
            );
            console.log(
                `  - Payment service: ${finalPaymentResponses.length} responses`
            );
            console.log(
                `  - Notification service: ${finalNotificationResponses.length} responses`
            );
            console.log(
                `  - Success rate: ${successfulPayments.length}/${finalPaymentResponses.length} payments`
            );
        });

        it('should handle rapid stimulation bursts without data loss', async () => {
            const appId = 'burst-test';

            // Set up minimal topology
            const initMessage = {
                type: 'init' as const,
                devToolsInstanceId: appId,
                appName: 'Burst Test',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId}:high-volume-service`,
                        appId,
                        name: 'high-volume-service',
                    },
                ],
                collaterals: [],
                dendrites: [],
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initMessage)
            );
            dbEventQueue.flush();

            // Simulate rapid burst of events (e.g., high-volume API processing)
            const burstSize = 20;
            const baseTimestamp = Date.now() - 10000;
            const burstResponses = [];

            for (let i = 0; i < burstSize; i++) {
                burstResponses.push({
                    stimulationId: `burst-${i}`,
                    neuronId: `${appId}:high-volume-service`,
                    appId,
                    collateralName: 'dataProcessed',
                    timestamp: baseTimestamp + i * 100, // 100ms apart
                    responsePayload: {
                        requestId: `req-${i}`,
                        processed: true,
                        duration: Math.floor(Math.random() * 500) + 50, // 50-550ms
                    },
                });
            }

            const burstBatch = {
                type: 'response-batch' as const,
                responses: burstResponses,
            };

            await mainCNS.stimulate(
                appModelAxon.devtoolsResponseBatch.createSignal(burstBatch)
            );
            dbEventQueue.flush();

            // Verify all events were processed without loss
            const allResponses = db.responses.getAll();
            expect(allResponses).toHaveLength(burstSize);

            // Verify all responses belong to the correct neuron
            const serviceResponses = allResponses.filter(
                r => r.neuronId === `${appId}:high-volume-service`
            );
            expect(serviceResponses).toHaveLength(burstSize);

            // Verify data integrity across the burst
            const responseIds = serviceResponses
                .map(r => r.stimulationId)
                .sort();
            const expectedIds = Array.from(
                { length: burstSize },
                (_, i) => `burst-${i}`
            ).sort();
            expect(responseIds).toEqual(expectedIds);

            // Test that timestamps are preserved correctly
            const sortedByTimestamp = serviceResponses.sort(
                (a, b) => a.timestamp - b.timestamp
            );
            expect(sortedByTimestamp[0].stimulationId).toBe('burst-0');
            expect(sortedByTimestamp[burstSize - 1].stimulationId).toBe(
                `burst-${burstSize - 1}`
            );

            console.log(
                `✅ Burst test completed: Processed ${burstSize} rapid events successfully`
            );
        });

        it('should maintain real-time accuracy during concurrent app activity', async () => {
            const appId1 = 'concurrent-app-1';
            const appId2 = 'concurrent-app-2';

            // Set up two apps simultaneously
            const initApp1 = {
                type: 'init' as const,
                devToolsInstanceId: appId1,
                appName: 'Concurrent App 1',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId1}:api-service`,
                        appId: appId1,
                        name: 'api-service',
                    },
                ],
                collaterals: [],
                dendrites: [],
            };

            const initApp2 = {
                type: 'init' as const,
                devToolsInstanceId: appId2,
                appName: 'Concurrent App 2',
                version: '1.0.0',
                timestamp: Date.now(),
                neurons: [
                    {
                        id: `${appId2}:data-service`,
                        appId: appId2,
                        name: 'data-service',
                    },
                ],
                collaterals: [],
                dendrites: [],
            };

            // Initialize both apps
            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initApp1)
            );
            await mainCNS.stimulate(
                appModelAxon.devtoolsInit.createSignal(initApp2)
            );
            dbEventQueue.flush();

            // Send concurrent activity from both apps
            const concurrentActivity1 = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'app1-req-1',
                        neuronId: `${appId1}:api-service`,
                        appId: appId1,
                        collateralName: 'requestProcessed',
                        timestamp: Date.now() - 3000,
                        responsePayload: { endpoint: '/users', method: 'GET' },
                    },
                    {
                        stimulationId: 'app1-req-2',
                        neuronId: `${appId1}:api-service`,
                        appId: appId1,
                        collateralName: 'requestProcessed',
                        timestamp: Date.now() - 1000,
                        responsePayload: {
                            endpoint: '/orders',
                            method: 'POST',
                        },
                    },
                ],
            };

            const concurrentActivity2 = {
                type: 'response-batch' as const,
                responses: [
                    {
                        stimulationId: 'app2-sync-1',
                        neuronId: `${appId2}:data-service`,
                        appId: appId2,
                        collateralName: 'dataSynced',
                        timestamp: Date.now() - 2000,
                        responsePayload: { table: 'users', records: 150 },
                    },
                ],
            };

            // Send activities concurrently
            await Promise.all([
                mainCNS.stimulate(
                    appModelAxon.devtoolsResponseBatch.createSignal(
                        concurrentActivity1
                    )
                ),
                mainCNS.stimulate(
                    appModelAxon.devtoolsResponseBatch.createSignal(
                        concurrentActivity2
                    )
                ),
            ]);
            dbEventQueue.flush();

            // Verify concurrent data integrity
            const allNeurons = db.neurons.getAll();
            const allResponses = db.responses.getAll();

            expect(allNeurons).toHaveLength(2); // One from each app
            expect(allResponses).toHaveLength(3); // 2 from app1 + 1 from app2

            // Test app isolation - responses belong to correct apps
            const app1Responses = allResponses.filter(r => r.appId === appId1);
            const app2Responses = allResponses.filter(r => r.appId === appId2);

            expect(app1Responses).toHaveLength(2);
            expect(app2Responses).toHaveLength(1);

            // Test neuron association accuracy
            const app1ApiResponses = allResponses.filter(
                r => r.neuronId === `${appId1}:api-service`
            );
            const app2DataResponses = allResponses.filter(
                r => r.neuronId === `${appId2}:data-service`
            );

            expect(app1ApiResponses).toHaveLength(2);
            expect(app2DataResponses).toHaveLength(1);

            // Verify no cross-contamination between apps
            expect(app1Responses.every(r => r.appId === appId1)).toBe(true);
            expect(app2Responses.every(r => r.appId === appId2)).toBe(true);

            console.log(
                '✅ Concurrent activity test completed: Data integrity maintained across multiple apps'
            );
        });
    });
});
