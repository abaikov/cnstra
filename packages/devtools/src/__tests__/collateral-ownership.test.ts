import { CNSDevTools } from '../index';
import { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { InitMessage, StimulateCommand } from '@cnstra/devtools-dto';

// Mock CNS for testing
class MockCNS {
    private neurons: any[] = [];
    private collaterals: any[] = [];
    private responseListeners: any[] = [];

    constructor(neurons: any[], collaterals: any[]) {
        this.neurons = neurons;
        this.collaterals = collaterals;
    }

    getNeurons() {
        return this.neurons;
    }

    getCollaterals() {
        return this.collaterals;
    }

    addResponseListener(fn: any) {
        this.responseListeners.push(fn);
    }

    getParentNeuronByCollateralName(collateralName: string) {
        return this.neurons.find(neuron => {
            const axonKeys = Object.keys(neuron.axon || {});
            return (
                axonKeys.includes(collateralName) ||
                axonKeys.includes(
                    collateralName.replace(
                        /-([a-z])/g,
                        (_: string, letter: string) => letter.toUpperCase()
                    )
                )
            );
        });
    }

    stimulate() {
        // Mock implementation
    }
}

// Mock transport for testing
class MockTransport implements ICNSDevToolsTransport {
    public sentMessages: any[] = [];
    public stimulateCommandHandler?: (cmd: StimulateCommand) => void;

    async sendInitMessage(message: InitMessage): Promise<void> {
        this.sentMessages.push(message);
    }

    async sendNeuronResponseMessage(message: any): Promise<void> {
        this.sentMessages.push(message);
    }

    onStimulateCommand(handler: (cmd: StimulateCommand) => void): () => void {
        this.stimulateCommandHandler = handler;
        return () => {}; // Return cleanup function
    }
}

describe('CNSDevTools Collateral Ownership Logic', () => {
    describe('Case Conversion and Matching', () => {
        it('should correctly match kebab-case collateral names to camelCase axon keys', async () => {
            // Setup neurons with camelCase axon keys
            const neurons = [
                {
                    name: 'auth-service',
                    axon: {
                        userAuthenticated: {}, // camelCase axon key
                        tokenGenerated: {},
                    },
                    dendrites: [],
                },
                {
                    name: 'search-service',
                    axon: {
                        searchResults: {}, // camelCase axon key
                        queryProcessed: {},
                    },
                    dendrites: [],
                },
            ];

            // Setup collaterals with kebab-case names (as they come from CNS core)
            const collaterals = [
                { name: 'user-authenticated' }, // kebab-case name
                { name: 'token-generated' },
                { name: 'search-results' },
                { name: 'query-processed' },
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'test-app',
            });

            // Wait for the init message to be sent
            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // Verify that collaterals are correctly associated with their parent neurons
            expect(initMessage.collaterals).toEqual([
                {
                    collateralName: 'user-authenticated',
                    neuronId: 'auth-service', // Should match despite case difference
                    appId: 'test-app',
                    type: 'default',
                },
                {
                    collateralName: 'token-generated',
                    neuronId: 'auth-service',
                    appId: 'test-app',
                    type: 'default',
                },
                {
                    collateralName: 'search-results',
                    neuronId: 'search-service',
                    appId: 'test-app',
                    type: 'default',
                },
                {
                    collateralName: 'query-processed',
                    neuronId: 'search-service',
                    appId: 'test-app',
                    type: 'default',
                },
            ]);
        });

        it('should correctly match exact case collateral names to axon keys', async () => {
            // Setup neurons with exact matching case
            const neurons = [
                {
                    name: 'exact-service',
                    axon: {
                        'exact-match': {}, // exact kebab-case match
                        anotherExact: {}, // exact camelCase match
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [
                { name: 'exact-match' }, // exact match
                { name: 'anotherExact' }, // exact match
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'test-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            expect(initMessage.collaterals).toEqual([
                {
                    collateralName: 'exact-match',
                    neuronId: 'exact-service',
                    appId: 'test-app',
                    type: 'default',
                },
                {
                    collateralName: 'anotherExact',
                    neuronId: 'exact-service',
                    appId: 'test-app',
                    type: 'default',
                },
            ]);
        });

        it('should prioritize direct matches over case conversions', async () => {
            // Setup a case where both direct and converted matches exist
            const neurons = [
                {
                    name: 'priority-service',
                    axon: {
                        'user-event': {}, // direct kebab-case match
                        userEvent: {}, // camelCase version
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [
                { name: 'user-event' }, // should match direct, not converted
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'test-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            expect(initMessage.collaterals).toEqual([
                {
                    collateralName: 'user-event',
                    neuronId: 'priority-service',
                    appId: 'test-app',
                    type: 'default',
                },
            ]);
        });
    });

    describe('Error Handling for Unknown Collaterals', () => {
        it('should throw descriptive error when collateral has no parent neuron', () => {
            // Setup neurons without matching axon keys
            const neurons = [
                {
                    name: 'service-1',
                    axon: {
                        knownCollateral: {},
                    },
                    dendrites: [],
                },
            ];

            // Setup collateral that doesn't match any axon key
            const collaterals = [{ name: 'unknown-collateral' }];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            expect(() => {
                new CNSDevTools(mockCNS as any, mockTransport, {
                    devToolsInstanceId: 'test-app',
                });
            }).toThrow(
                /Unable to find parent neuron for collateral "unknown-collateral"/
            );
        });

        it('should include available axon keys in error message for debugging', () => {
            const neurons = [
                {
                    name: 'service-1',
                    axon: {
                        validKey1: {},
                        validKey2: {},
                    },
                    dendrites: [],
                },
                {
                    name: 'service-2',
                    axon: {
                        validKey3: {},
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [{ name: 'invalid-key' }];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            expect(() => {
                new CNSDevTools(mockCNS as any, mockTransport, {
                    devToolsInstanceId: 'test-app',
                });
            }).toThrow(
                /Available axon keys: \[validKey1, validKey2, validKey3\]/
            );
        });

        it('should indicate axon definition mismatch in error message', () => {
            const neurons = [
                {
                    name: 'service-1',
                    axon: {
                        someKey: {},
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [{ name: 'mismatched-key' }];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            expect(() => {
                new CNSDevTools(mockCNS as any, mockTransport, {
                    devToolsInstanceId: 'test-app',
                });
            }).toThrow(
                /This indicates a mismatch between collateral names and neuron axon definitions/
            );
        });
    });

    describe('Edge Generation Support', () => {
        it('should generate proper neuron topology for edge generation', async () => {
            // Setup e-commerce example similar to the actual application
            const neurons = [
                {
                    name: 'auth-service',
                    axon: {
                        userAuthenticated: {},
                        tokenGenerated: {},
                    },
                    dendrites: [{ collateral: { name: 'user-registration' } }],
                },
                {
                    name: 'user-service',
                    axon: {
                        userRegistration: {},
                        userProfileUpdated: {},
                    },
                    dendrites: [{ collateral: { name: 'user-authenticated' } }],
                },
            ];

            const collaterals = [
                { name: 'user-authenticated' },
                { name: 'token-generated' },
                { name: 'user-registration' },
                { name: 'user-profile-updated' },
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'ecommerce-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // Verify neurons contain axon information for edge generation
            expect(
                initMessage.neurons.map(n => ({
                    id: n.id,
                    axonCollaterals: n.axonCollaterals,
                }))
            ).toEqual([
                {
                    id: 'ecommerce-app:auth-service',
                    axonCollaterals: ['userAuthenticated', 'tokenGenerated'],
                },
                {
                    id: 'ecommerce-app:user-service',
                    axonCollaterals: ['userRegistration', 'userProfileUpdated'],
                },
            ]);

            // Verify collaterals are properly owned
            expect(
                initMessage.collaterals.every(c => c.neuronId !== 'unknown')
            ).toBe(true);

            // Verify dendrites show listening relationships
            expect(
                initMessage.dendrites.map(d => ({
                    neuronId: d.neuronId,
                    collateralName: d.collateralName,
                }))
            ).toEqual([
                {
                    neuronId: 'ecommerce-app:auth-service',
                    collateralName: 'user-registration',
                },
                {
                    neuronId: 'ecommerce-app:user-service',
                    collateralName: 'user-authenticated',
                },
            ]);
        });
    });

    describe('Real-world E-commerce Scenario', () => {
        it('should handle complete e-commerce microservice topology correctly', async () => {
            // Replicate the exact scenario from the actual app that was failing
            const neurons = [
                {
                    name: 'auth-service',
                    axon: { userAuthenticated: {}, tokenGenerated: {} },
                    dendrites: [{ collateral: { name: 'user-registration' } }],
                },
                {
                    name: 'user-service',
                    axon: { userRegistration: {}, userProfileUpdated: {} },
                    dendrites: [{ collateral: { name: 'user-authenticated' } }],
                },
                {
                    name: 'product-service',
                    axon: { productListed: {}, inventoryUpdated: {} },
                    dendrites: [],
                },
                {
                    name: 'search-service',
                    axon: { searchResults: {}, searchIndexUpdated: {} },
                    dendrites: [{ collateral: { name: 'product-listed' } }],
                },
                {
                    name: 'cart-service',
                    axon: { itemAdded: {}, cartUpdated: {} },
                    dendrites: [{ collateral: { name: 'user-authenticated' } }],
                },
                {
                    name: 'order-service',
                    axon: { orderCreated: {}, orderStatusUpdated: {} },
                    dendrites: [{ collateral: { name: 'cart-updated' } }],
                },
                {
                    name: 'payment-service',
                    axon: { paymentProcessed: {}, paymentFailed: {} },
                    dendrites: [{ collateral: { name: 'order-created' } }],
                },
                {
                    name: 'inventory-service',
                    axon: { stockUpdated: {}, lowStockAlert: {} },
                    dendrites: [{ collateral: { name: 'order-created' } }],
                },
                {
                    name: 'notification-service',
                    axon: { notificationSent: {} },
                    dendrites: [
                        { collateral: { name: 'order-status-updated' } },
                        { collateral: { name: 'payment-processed' } },
                        { collateral: { name: 'low-stock-alert' } },
                    ],
                },
            ];

            const collaterals = [
                { name: 'user-authenticated' },
                { name: 'token-generated' },
                { name: 'user-registration' },
                { name: 'user-profile-updated' },
                { name: 'product-listed' },
                { name: 'inventory-updated' },
                { name: 'search-results' },
                { name: 'search-index-updated' },
                { name: 'item-added' },
                { name: 'cart-updated' },
                { name: 'order-created' },
                { name: 'order-status-updated' },
                { name: 'payment-processed' },
                { name: 'payment-failed' },
                { name: 'stock-updated' },
                { name: 'low-stock-alert' },
                { name: 'notification-sent' },
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'ecommerce-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // Verify ALL collaterals have proper neuron ownership (no "unknown" values)
            const unknownCollaterals = initMessage.collaterals.filter(
                c => c.neuronId === 'unknown'
            );
            expect(unknownCollaterals).toEqual([]);

            // Verify specific case conversions work correctly
            expect(
                initMessage.collaterals.find(
                    c => c.collateralName === 'user-authenticated'
                )
            ).toEqual({
                collateralName: 'user-authenticated',
                neuronId: 'auth-service',
                appId: 'ecommerce-app',
                type: 'default',
            });

            expect(
                initMessage.collaterals.find(
                    c => c.collateralName === 'search-results'
                )
            ).toEqual({
                collateralName: 'search-results',
                neuronId: 'search-service',
                appId: 'ecommerce-app',
                type: 'default',
            });

            // Verify all expected collaterals are present and owned
            expect(initMessage.collaterals).toHaveLength(17);
            expect(
                initMessage.collaterals.every(
                    c =>
                        typeof c.neuronId === 'string' &&
                        c.neuronId.length > 0 &&
                        c.neuronId !== 'unknown'
                )
            ).toBe(true);
        });
    });
});
