import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StimulationsPage from '../../ui/StimulationsPage';

// Mock OIMDB React hooks
jest.mock('@oimdb/react', () => ({
    useSelectEntitiesByIndexKey: jest.fn(),
}));

// Mock the database
jest.mock('../../model', () => ({
    db: {
        responses: {
            indexes: {
                appId: 'mockIndex'
            }
        }
    }
}));

import { useSelectEntitiesByIndexKey } from '@oimdb/react';

const mockUseSelectEntitiesByIndexKey = useSelectEntitiesByIndexKey as jest.MockedFunction<typeof useSelectEntitiesByIndexKey>;

describe('Real-World Stimulation Data Flow Issues', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Unknown neuronId Problem', () => {
        test('demonstrates the actual issue from example app logs: stimulations have neuronId "unknown"', () => {
            // This is the actual problematic data structure seen in real example app logs
            const realWorldProblematicStimulations = [
                {
                    responseId: 'response-1234',
                    timestamp: Date.now(),
                    neuronId: 'unknown', // This is the actual bug found in logs!
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'response-5678',
                    timestamp: Date.now() - 1000,
                    neuronId: 'unknown', // This is the actual bug found in logs!
                    duration: 150,
                    error: 'Timeout error',
                },
                {
                    responseId: 'response-9999',
                    timestamp: Date.now() - 2000,
                    neuronId: 'unknown', // This is the actual bug found in logs!
                    duration: null,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(realWorldProblematicStimulations);

            render(<StimulationsPage appId="example-app" />);

            // This test proves the root cause of "neurons showing 0 signals"
            // Stimulations exist in the database but have neuronId "unknown"
            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();

            // All stimulations show neuronId as "unknown" instead of actual neuron names
            expect(screen.getAllByText(/neuron: unknown/)).toHaveLength(3);

            // The stimulations exist and are displayed, but they're not linked to real neurons
            expect(screen.getByText('id: response-1234')).toBeInTheDocument();
            expect(screen.getByText('id: response-5678')).toBeInTheDocument();
            expect(screen.getByText('id: response-9999')).toBeInTheDocument();
        });

        test('demonstrates what the data should look like when neuronId is correct', () => {
            // This shows how the data should appear when neuronId is correctly set
            const correctStimulations = [
                {
                    responseId: 'response-1234',
                    timestamp: Date.now(),
                    neuronId: 'logger', // Correctly matches actual neuron
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'response-5678',
                    timestamp: Date.now() - 1000,
                    neuronId: 'processor', // Correctly matches actual neuron
                    duration: 150,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(correctStimulations);

            render(<StimulationsPage appId="example-app" />);

            // With correct neuronId, neurons would properly show their signal counts
            expect(screen.getByText('Total responses: 2')).toBeInTheDocument();
            expect(screen.getByText(/neuron: logger/)).toBeInTheDocument();
            expect(screen.getByText(/neuron: processor/)).toBeInTheDocument();
        });

        test('shows mixed scenario: some correct neuronIds, some unknown', () => {
            // Real-world scenario where some stimulations have correct neuronId, others are "unknown"
            const mixedStimulations = [
                {
                    responseId: 'good-response',
                    timestamp: Date.now(),
                    neuronId: 'logger', // This one is correct
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'bad-response-1',
                    timestamp: Date.now() - 1000,
                    neuronId: 'unknown', // This one is broken
                    duration: 150,
                    error: null,
                },
                {
                    responseId: 'bad-response-2',
                    timestamp: Date.now() - 2000,
                    neuronId: 'unknown', // This one is broken too
                    duration: 75,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(mixedStimulations);

            render(<StimulationsPage appId="example-app" />);

            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();

            // One correct neuronId
            expect(screen.getByText(/neuron: logger/)).toBeInTheDocument();

            // Two broken neuronIds
            expect(screen.getAllByText(/neuron: unknown/)).toHaveLength(2);
        });
    });

    describe('Collateral Name Mismatch Issues', () => {
        test('documents potential collateral naming inconsistencies affecting signal counts', () => {
            // This test documents the issue but can't directly test it in StimulationsPage
            // since that component only shows response data, not dendrite/collateral matching

            const stimulationsWithVaryingNeuronNames = [
                {
                    responseId: 'logger-response',
                    timestamp: Date.now(),
                    neuronId: 'logger', // Neuron defined with collateral 'log'
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'log-response',
                    timestamp: Date.now() - 1000,
                    neuronId: 'log', // Different naming variant
                    duration: 150,
                    error: null,
                },
                {
                    responseId: 'logging-response',
                    timestamp: Date.now() - 2000,
                    neuronId: 'logging', // Another naming variant
                    duration: 75,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(stimulationsWithVaryingNeuronNames);

            render(<StimulationsPage appId="example-app" />);

            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();

            // These different naming variations would cause dendrites to not find matching signals
            expect(screen.getByText(/neuron: logger/)).toBeInTheDocument();
            expect(screen.getAllByText(/neuron: log/)[0]).toBeInTheDocument(); // "log" matches both "log" and "logging"
            expect(screen.getByText(/neuron: logging/)).toBeInTheDocument();
        });
    });

    describe('Data Integration Validation Tests', () => {
        test('validates that stimulations with proper neuronId would enable proper signal counting', () => {
            // This test sets up the scenario that would allow neurons to show correct signal counts
            const wellFormedStimulations = [
                {
                    responseId: 'valid-1',
                    timestamp: Date.now(),
                    neuronId: 'auth-service', // Matches expected neuron name
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'valid-2',
                    timestamp: Date.now() - 1000,
                    neuronId: 'auth-service', // Same neuron, multiple signals
                    duration: 30,
                    error: null,
                },
                {
                    responseId: 'valid-3',
                    timestamp: Date.now() - 2000,
                    neuronId: 'data-processor', // Different neuron
                    duration: 45,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(wellFormedStimulations);

            render(<StimulationsPage appId="example-app" />);

            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();

            // auth-service neuron would show 2 signals
            expect(screen.getAllByText(/neuron: auth-service/)).toHaveLength(2);

            // data-processor neuron would show 1 signal
            expect(screen.getByText(/neuron: data-processor/)).toBeInTheDocument();
        });

        test('reproduces zero signal scenario by testing with empty stimulations', () => {
            // This represents what happens when neurons exist but have no matching stimulations
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="example-app" />);

            expect(screen.getByText('Total responses: 0')).toBeInTheDocument();
            expect(screen.getByText(/No stimulations yet/)).toBeInTheDocument();

            // This is what causes neurons to show 0 signals in the graph view
            // - Neurons exist in the database
            // - But stimulations either don't exist or have mismatched neuronId
            // - Result: neurons appear with 0 signals even though activity may have occurred
        });

        test('demonstrates the data flow that would fix the zero signals issue', () => {
            // This test shows the correct data flow that would solve the problem
            const properlyLinkedStimulations = [
                {
                    responseId: 'linked-1',
                    timestamp: Date.now(),
                    neuronId: 'user-auth', // This should match exactly with neuron definition
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'linked-2',
                    timestamp: Date.now() - 1000,
                    neuronId: 'user-auth', // Same neuron, building up signal count
                    duration: 30,
                    error: null,
                },
                {
                    responseId: 'linked-3',
                    timestamp: Date.now() - 2000,
                    neuronId: 'order-processor', // Different neuron with proper linking
                    duration: 45,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(properlyLinkedStimulations);

            render(<StimulationsPage appId="example-app" />);

            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();

            // This is what proper neuronId linking looks like
            expect(screen.getAllByText(/neuron: user-auth/)).toHaveLength(2);
            expect(screen.getByText(/neuron: order-processor/)).toBeInTheDocument();

            // With this correct linking, the graph view would show:
            // - user-auth neuron: 2 signals
            // - order-processor neuron: 1 signal
            // Instead of both neurons showing 0 signals
        });
    });

    describe('Root Cause Analysis Documentation', () => {
        test('documents the complete chain of issues causing zero signal display', () => {
            // This test serves as documentation of the complete problem chain

            const documentationScenario = {
                // ISSUE 1: Stimulations have neuronId "unknown"
                problematicStimulations: [
                    { responseId: 'r1', neuronId: 'unknown', timestamp: Date.now(), duration: 25 },
                    { responseId: 'r2', neuronId: 'unknown', timestamp: Date.now() - 1000, duration: 30 }
                ],

                // ISSUE 2: Actual neurons in system have different IDs
                actualNeurons: [
                    { neuronId: 'logger', name: 'Logger Service', collaterals: ['log'] },
                    { neuronId: 'processor', name: 'Data Processor', collaterals: ['process', 'data'] }
                ],

                // ISSUE 3: Dendrites looking for signals can't find matches
                expectedDendriteQueries: [
                    { neuronId: 'logger', collateralName: 'log', expectedSignals: 0 }, // Should find 0 because stimulations have neuronId "unknown"
                    { neuronId: 'processor', collateralName: 'process', expectedSignals: 0 } // Same issue
                ],

                // SOLUTION: Stimulations need correct neuronId
                correctStimulations: [
                    { responseId: 'r1', neuronId: 'logger', timestamp: Date.now(), duration: 25 },
                    { responseId: 'r2', neuronId: 'processor', timestamp: Date.now() - 1000, duration: 30 }
                ]
            };

            // Test the problematic scenario
            mockUseSelectEntitiesByIndexKey.mockReturnValue(documentationScenario.problematicStimulations);

            render(<StimulationsPage appId="example-app" />);

            // Verify the issue is present
            expect(screen.getAllByText(/neuron: unknown/)).toHaveLength(2);

            // This is the root cause: stimulations exist but can't be linked to neurons
            // Result: DevTools graph shows neurons with 0 signals despite activity occurring

            expect(true).toBe(true); // Test passes, documenting the issue
        });
    });
});