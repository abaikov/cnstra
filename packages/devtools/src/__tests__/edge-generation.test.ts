import { CNSDevTools } from '../index';
import { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { InitMessage, StimulateCommand } from '@cnstra/devtools-dto';

// Mock implementations for testing edge generation scenarios
class MockCNS {
    constructor(private neurons: any[], private collaterals: any[]) {}

    getNeurons() {
        return this.neurons;
    }
    getCollaterals() {
        return this.collaterals;
    }
    addResponseListener() {}
    getParentNeuronByCollateralName() {
        return null;
    }
    stimulate() {}
}

class MockTransport implements ICNSDevToolsTransport {
    public sentMessages: any[] = [];
    async sendInitMessage(message: InitMessage): Promise<void> {
        this.sentMessages.push(message);
    }
    async sendNeuronResponseMessage(): Promise<void> {}
    onStimulateCommand(): () => void {
        return () => {}; // Return cleanup function
    }
}

describe('CNSDevTools Edge Generation Logic', () => {
    describe('Complex Case Conversion Scenarios', () => {
        it('should handle mixed case patterns in axon keys', async () => {
            const neurons = [
                {
                    name: 'complex-service',
                    axon: {
                        XMLHttpRequest: {}, // Acronym + CamelCase
                        httpAPICall: {}, // lowercase + Acronym + CamelCase
                        'user-data-updated': {}, // kebab-case
                        fileIOCompleted: {}, // camelCase with acronym
                        simple: {}, // simple lowercase
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [
                { name: 'XML-http-request' }, // kebab version of XMLHttpRequest
                { name: 'http-API-call' }, // kebab version of httpAPICall
                { name: 'user-data-updated' }, // exact match
                { name: 'file-IO-completed' }, // kebab version of fileIOCompleted
                { name: 'simple' }, // exact match
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            // This should not throw an error - all collaterals should be matched
            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'test-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // All collaterals should be properly owned
            expect(
                initMessage.collaterals.every(
                    c => c.neuronId === 'complex-service'
                )
            ).toBe(true);

            expect(initMessage.collaterals).toHaveLength(5);
        });

        it('should handle edge cases in kebab-case to camelCase conversion', async () => {
            const neurons = [
                {
                    name: 'edge-case-service',
                    axon: {
                        a: {}, // single letter
                        aB: {}, // two letters
                        someVeryLongMethodName: {}, // long camelCase
                        x: {}, // single letter
                        API: {}, // all caps
                        httpAPI: {}, // mixed case
                        xmlHttpRequestAPI: {}, // complex case
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [
                { name: 'a' }, // single letter exact
                { name: 'a-b' }, // kebab for 'aB'
                { name: 'some-very-long-method-name' }, // kebab for long name
                { name: 'x' }, // single letter exact
                { name: 'API' }, // all caps exact
                { name: 'http-API' }, // mixed conversion
                { name: 'xml-http-request-API' }, // complex conversion
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'test-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // All collaterals should be matched
            expect(
                initMessage.collaterals.every(
                    c => c.neuronId === 'edge-case-service'
                )
            ).toBe(true);

            expect(initMessage.collaterals).toHaveLength(7);
        });

        it('should handle collaterals that convert to existing axon keys differently', async () => {
            // Test case where conversion might create ambiguity
            const neurons = [
                {
                    name: 'ambiguity-service',
                    axon: {
                        userEvent: {}, // camelCase
                        'user-event': {}, // kebab-case (different key)
                        dataSync: {}, // camelCase
                        'data-sync': {}, // kebab-case (different key)
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [
                { name: 'user-event' }, // should match kebab-case exactly
                { name: 'data-sync' }, // should match kebab-case exactly
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'test-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // Should prefer exact matches over conversions
            expect(
                initMessage.collaterals.every(
                    c => c.neuronId === 'ambiguity-service'
                )
            ).toBe(true);

            expect(initMessage.collaterals).toHaveLength(2);
        });
    });

    describe('Multi-Neuron Edge Generation', () => {
        it('should correctly distribute collaterals across multiple neurons', async () => {
            const neurons = [
                {
                    name: 'neuron-a',
                    axon: {
                        eventOne: {},
                        eventTwo: {},
                    },
                    dendrites: [{ collateral: { name: 'input-event' } }],
                },
                {
                    name: 'neuron-b',
                    axon: {
                        eventThree: {},
                        eventFour: {},
                    },
                    dendrites: [
                        { collateral: { name: 'event-one' } },
                        { collateral: { name: 'event-two' } },
                    ],
                },
                {
                    name: 'neuron-c',
                    axon: {
                        finalEvent: {},
                    },
                    dendrites: [
                        { collateral: { name: 'event-three' } },
                        { collateral: { name: 'event-four' } },
                    ],
                },
            ];

            const collaterals = [
                { name: 'input-event' },
                { name: 'event-one' },
                { name: 'event-two' },
                { name: 'event-three' },
                { name: 'event-four' },
                { name: 'final-event' },
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'test-app',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // Verify correct distribution
            const collateralsByNeuron = initMessage.collaterals.reduce(
                (acc, c) => {
                    if (!acc[c.neuronId]) acc[c.neuronId] = [];
                    acc[c.neuronId].push(c.collateralName);
                    return acc;
                },
                {} as Record<string, string[]>
            );

            expect(collateralsByNeuron['test-app:neuron-a']).toEqual([
                'event-one',
                'event-two',
            ]);
            expect(collateralsByNeuron['test-app:neuron-b']).toEqual([
                'event-three',
                'event-four',
            ]);
            expect(collateralsByNeuron['test-app:neuron-c']).toEqual(['final-event']);

            // Verify dendrites for edge generation
            const dendritesByNeuron = initMessage.dendrites.reduce((acc, d) => {
                if (!acc[d.neuronId]) acc[d.neuronId] = [];
                acc[d.neuronId].push(d.collateralName);
                return acc;
            }, {} as Record<string, string[]>);

            expect(dendritesByNeuron['test-app:neuron-a']).toEqual(['input-event']);
            expect(dendritesByNeuron['test-app:neuron-b']).toEqual([
                'event-one',
                'event-two',
            ]);
            expect(dendritesByNeuron['test-app:neuron-c']).toEqual([
                'event-three',
                'event-four',
            ]);

            // All collaterals should have owners
            expect(
                initMessage.collaterals.every(c => c.neuronId !== 'unknown')
            ).toBe(true);
        });
    });

    describe('Error Scenarios for Edge Generation', () => {
        it('should fail fast with clear error for completely unmatched collateral', () => {
            const neurons = [
                {
                    name: 'service-a',
                    axon: { validKey: {} },
                    dendrites: [],
                },
            ];

            const collaterals = [{ name: 'completely-different-key' }];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            expect(() => {
                new CNSDevTools(mockCNS as any, mockTransport, {
                    devToolsInstanceId: 'test-app',
                });
            }).toThrow(
                /Unable to find parent neuron for collateral "completely-different-key"/
            );
        });

        it('should handle empty neurons array gracefully', () => {
            const neurons: any[] = [];
            const collaterals = [{ name: 'orphaned-collateral' }];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            expect(() => {
                new CNSDevTools(mockCNS as any, mockTransport, {
                    devToolsInstanceId: 'test-app',
                });
            }).toThrow(
                /Unable to find parent neuron for collateral "orphaned-collateral"/
            );
        });

        it('should handle neurons with empty axon objects', () => {
            const neurons = [
                {
                    name: 'empty-neuron',
                    axon: {}, // Empty axon
                    dendrites: [],
                },
            ];

            const collaterals = [{ name: 'some-collateral' }];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            expect(() => {
                new CNSDevTools(mockCNS as any, mockTransport, {
                    devToolsInstanceId: 'test-app',
                });
            }).toThrow(
                /Unable to find parent neuron for collateral "some-collateral"/
            );
        });

        it('should handle neurons with null/undefined axon', () => {
            const neurons = [
                {
                    name: 'null-axon-neuron',
                    axon: null, // Null axon
                    dendrites: [],
                },
                {
                    name: 'undefined-axon-neuron',
                    // No axon property (undefined)
                    dendrites: [],
                },
            ];

            const collaterals = [{ name: 'some-collateral' }];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            expect(() => {
                new CNSDevTools(mockCNS as any, mockTransport, {
                    devToolsInstanceId: 'test-app',
                });
            }).toThrow(
                /Unable to find parent neuron for collateral "some-collateral"/
            );
        });
    });

    describe('Performance and Edge Case Handling', () => {
        it('should handle large numbers of neurons and collaterals efficiently', async () => {
            // Generate a large number of neurons and collaterals to test performance
            const neurons = Array.from({ length: 100 }, (_, i) => ({
                name: `service-${i}`,
                axon: {
                    [`event${i}Alpha`]: {},
                    [`event${i}Beta`]: {},
                    [`event${i}Gamma`]: {},
                },
                dendrites:
                    i > 0
                        ? [{ collateral: { name: `event${i - 1}-alpha` } }]
                        : [],
            }));

            const collaterals = neurons.flatMap((_, i) => [
                { name: `event${i}-alpha` },
                { name: `event${i}-beta` },
                { name: `event${i}-gamma` },
            ]);

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            // This should complete without errors or timeouts
            const startTime = Date.now();
            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'performance-test',
            });

            await new Promise(resolve => setTimeout(resolve, 0));
            const endTime = Date.now();

            const initMessage = mockTransport.sentMessages[0] as InitMessage;

            // Should complete in reasonable time (less than 1 second)
            expect(endTime - startTime).toBeLessThan(1000);

            // All collaterals should be properly matched
            expect(initMessage.collaterals).toHaveLength(300); // 100 neurons * 3 collaterals each
            expect(
                initMessage.collaterals.every(c => c.neuronId !== 'unknown')
            ).toBe(true);
        });

        it('should handle special characters in collateral names', () => {
            const neurons = [
                {
                    name: 'special-service',
                    axon: {
                        event_with_underscores: {},
                        'event.with.dots': {},
                        event$with$dollars: {},
                        eventWithNumbers123: {},
                    },
                    dendrites: [],
                },
            ];

            const collaterals = [
                { name: 'event_with_underscores' },
                { name: 'event.with.dots' },
                { name: 'event$with$dollars' },
                { name: 'event-with-numbers123' }, // kebab case version
            ];

            const mockCNS = new MockCNS(neurons, collaterals);
            const mockTransport = new MockTransport();

            const devTools = new CNSDevTools(mockCNS as any, mockTransport, {
                devToolsInstanceId: 'special-chars-test',
            });

            // Should handle special characters without throwing
            expect(devTools).toBeDefined();
        });
    });
});
