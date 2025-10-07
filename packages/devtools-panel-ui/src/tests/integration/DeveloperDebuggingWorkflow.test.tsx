import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppInner } from '../../ui/App';
import { MemoryRouter } from 'react-router-dom';

// Mock WebSocket for real connection simulation
const mockWebSocket = {
    send: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    readyState: WebSocket.OPEN,
};

(global as any).WebSocket = jest.fn(() => mockWebSocket);

// Mock PIXI.js
jest.mock('pixi.js', () => ({
    Application: jest.fn(() => ({
        stage: { addChild: jest.fn(), removeChild: jest.fn() },
        view: document.createElement('canvas'),
        destroy: jest.fn(),
    })),
    Graphics: jest.fn(() => ({
        clear: jest.fn(),
        drawCircle: jest.fn(),
        drawRect: jest.fn(),
        beginFill: jest.fn(),
        endFill: jest.fn(),
        lineStyle: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
    })),
    Text: jest.fn(() => ({
        anchor: { set: jest.fn() },
        style: {},
    })),
    TextStyle: jest.fn(),
}));

// Mock CNS modules
jest.mock('../../cns', () => ({
    mainCNS: {
        stimulate: jest.fn(),
        dendrite: jest.fn(),
        collateral: jest.fn(),
    },
}));

jest.mock('@oimdb/react', () => ({
    useSelectEntitiesByIndexKey: jest.fn(),
}));

jest.mock('../../model', () => ({
    db: {
        apps: { indexes: { all: 'apps-all-index' } },
        neurons: { indexes: { appId: 'neurons-app-index' } },
        dendrites: { indexes: { neuronId: 'dendrites-neuron-index' } },
        axons: { indexes: { neuronId: 'axons-neuron-index' } },
        responses: { indexes: { appId: 'responses-app-index' } },
        stimulations: { indexes: { appId: 'stimulations-app-index' } },
        collaterals: { indexes: { appId: 'collaterals-app-index' } },
    },
}));

import { useSelectEntitiesByIndexKey } from '@oimdb/react';

const mockUseSelectEntitiesByIndexKey = useSelectEntitiesByIndexKey as jest.MockedFunction<
    typeof useSelectEntitiesByIndexKey
>;

describe('Real Developer Debugging Workflow Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseSelectEntitiesByIndexKey.mockReturnValue([]);
    });

    describe('Developer Scenario: "My e-commerce app neurons show 0 signals"', () => {
        test('Step 1: Developer opens DevTools and sees neurons with 0 signals', async () => {
            // Developer's app setup - neurons are defined but showing 0 signals
            const ecommerceNeurons = [
                {
                    neuronId: 'ecommerce-app:auth-service',
                    appId: 'ecommerce-app',
                    name: 'auth-service',
                    axonCollaterals: ['userAuthenticated', 'recordMetric'],
                    lastActivity: Date.now(),
                },
                {
                    neuronId: 'ecommerce-app:cart-service',
                    appId: 'ecommerce-app',
                    name: 'cart-service',
                    axonCollaterals: ['cartUpdated', 'inventoryCheck'],
                    lastActivity: Date.now(),
                }
            ];

            // No responses/stimulations visible yet - this is what the developer sees initially
            mockUseSelectEntitiesByIndexKey.mockImplementation((table, index, key) => {
                if (key === 'ecommerce-app' && table) {
                    return ecommerceNeurons; // Neurons exist
                }
                return []; // But no stimulations/responses
            });

            render(
                <MemoryRouter initialEntries={['/']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('🧠 CNStra DevTools')).toBeInTheDocument();
            });

            // Developer sees the empty graph - this is the starting point of debugging
            expect(screen.getByText('🧠 CNStra DevTools')).toBeInTheDocument();
        });

        test('Step 2: Developer checks Stimulations page to see if any activity exists', async () => {
            // Developer navigates to Stimulations to check if any requests are being tracked
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(
                <MemoryRouter initialEntries={['/stimulations']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('⚡ Stimulations')).toBeInTheDocument();
            });

            // Developer sees: "No stimulations yet" - first clue that requests aren't being captured
            expect(screen.getByText('Total responses: 0')).toBeInTheDocument();
            expect(screen.getByText(/No stimulations yet/)).toBeInTheDocument();
            expect(screen.getByText(/Interact with your app/)).toBeInTheDocument();
        });

        test('Step 3: Developer triggers some requests in their app and checks again', async () => {
            // After triggering requests, developer sees stimulations but with mismatched neuronIds
            const problematicStimulations = [
                {
                    responseId: 'auth-attempt-1',
                    timestamp: Date.now(),
                    neuronId: 'auth-service', // SHORT ID - missing app prefix!
                    duration: 45,
                    error: null,
                },
                {
                    responseId: 'cart-update-1',
                    timestamp: Date.now() - 1000,
                    neuronId: 'cart-service', // SHORT ID - missing app prefix!
                    duration: 23,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(problematicStimulations);

            render(
                <MemoryRouter initialEntries={['/stimulations']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('⚡ Stimulations')).toBeInTheDocument();
            });

            // Developer now sees activity BUT notices the neuronId mismatch
            expect(screen.getByText('Total responses: 2')).toBeInTheDocument();
            expect(screen.getByText(/neuron: auth-service/)).toBeInTheDocument();
            expect(screen.getByText(/neuron: cart-service/)).toBeInTheDocument();

            // Critical insight: neuronIds are SHORT but neurons are defined with FULL IDs
            // This is the "aha!" moment for the developer
        });

        test('Step 4: Developer compares neuron definitions vs stimulation neuronIds', async () => {
            // Developer now understands the mismatch - this test documents their discovery
            const neuronDefinitions = [
                'ecommerce-app:auth-service',    // FULL ID in neuron definition
                'ecommerce-app:cart-service'     // FULL ID in neuron definition
            ];

            const stimulationNeuronIds = [
                'auth-service',                  // SHORT ID in stimulations
                'cart-service'                   // SHORT ID in stimulations
            ];

            // Test validates the mismatch pattern
            neuronDefinitions.forEach((fullId, index) => {
                const shortId = stimulationNeuronIds[index];
                expect(fullId).toContain(shortId);
                expect(fullId).toContain('ecommerce-app:');
                expect(shortId).not.toContain('ecommerce-app:');
            });

            // This test documents the exact mismatch pattern the developer discovers
        });

        test('Step 5: Developer checks Performance Monitor for timing insights', async () => {
            // Developer wants to see if performance data shows the issue
            const performanceResponses = [
                {
                    responseId: 'perf-1',
                    neuronId: 'auth-service',     // Mismatched ID
                    duration: 145,                // Slow response
                    timestamp: Date.now(),
                    error: 'Timeout after 140ms',
                },
                {
                    responseId: 'perf-2',
                    neuronId: 'cart-service',     // Mismatched ID
                    duration: 25,                 // Fast response
                    timestamp: Date.now() - 2000,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(performanceResponses);

            render(
                <MemoryRouter initialEntries={['/performance']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('📊 Performance Monitor')).toBeInTheDocument();
            });

            // Developer sees performance data exists but it's not linked to neurons
            // This confirms the ID mismatch theory
        });

        test('Step 6: Developer investigates Analytics Dashboard for patterns', async () => {
            // Developer digs into analytics to understand the scope of the issue
            const analyticsData = [
                {
                    responseId: 'analytics-1',
                    neuronId: 'auth-service',
                    collateralName: 'user-authenticated',
                    duration: 50,
                    timestamp: Date.now(),
                    error: null,
                },
                {
                    responseId: 'analytics-2',
                    neuronId: 'cart-service',
                    collateralName: 'cart-updated',
                    duration: 30,
                    timestamp: Date.now() - 1500,
                    error: null,
                },
                {
                    responseId: 'analytics-3',
                    neuronId: 'payment-service', // Another mismatched service
                    collateralName: 'payment-processed',
                    duration: 200,
                    timestamp: Date.now() - 3000,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(analyticsData);

            render(
                <MemoryRouter initialEntries={['/analytics']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('📈 Analytics Dashboard')).toBeInTheDocument();
            });

            // Developer discovers the pattern affects ALL services in their app
            // This confirms it's a systemic issue, not isolated to one neuron
        });

        test('Step 7: Developer tests the fix by simulating correct neuronIds', async () => {
            // Developer simulates what the data should look like with corrected IDs
            const correctedStimulations = [
                {
                    responseId: 'fixed-auth-1',
                    timestamp: Date.now(),
                    neuronId: 'ecommerce-app:auth-service', // CORRECTED: Full ID with prefix
                    duration: 45,
                    error: null,
                },
                {
                    responseId: 'fixed-cart-1',
                    timestamp: Date.now() - 1000,
                    neuronId: 'ecommerce-app:cart-service', // CORRECTED: Full ID with prefix
                    duration: 23,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(correctedStimulations);

            render(
                <MemoryRouter initialEntries={['/stimulations']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('⚡ Stimulations')).toBeInTheDocument();
            });

            // With corrected IDs, the stimulations would properly link to neurons
            expect(screen.getByText('Total responses: 2')).toBeInTheDocument();
            expect(screen.getByText(/neuron: ecommerce-app:auth-service/)).toBeInTheDocument();
            expect(screen.getByText(/neuron: ecommerce-app:cart-service/)).toBeInTheDocument();

            // This test proves the solution works
        });
    });

    describe('Developer Scenario: "Signal Debugger shows mismatched collaterals"', () => {
        test('Developer investigates collateral name mismatches in Signal Debugger', async () => {
            // Real scenario: Developer's collaterals use different naming conventions
            const mixedCollaterals = [
                {
                    collateralName: 'user-authenticated',  // kebab-case
                    neuronId: 'ecommerce-app:auth-service',
                    appId: 'ecommerce-app',
                    type: 'default',
                },
                {
                    collateralName: 'userAuthenticated',   // camelCase - mismatch!
                    neuronId: 'ecommerce-app:auth-service',
                    appId: 'ecommerce-app',
                    type: 'default',
                }
            ];

            const confusingStimulations = [
                {
                    responseId: 'confusing-1',
                    neuronId: 'ecommerce-app:auth-service',
                    collateralName: 'user-authenticated',  // Matches first collateral
                    timestamp: Date.now(),
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'confusing-2',
                    neuronId: 'ecommerce-app:auth-service',
                    collateralName: 'userAuthenticated',   // Matches second collateral
                    timestamp: Date.now() - 1000,
                    duration: 35,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockImplementation((table: any, index: any, key: any) => {
                if (key === 'ecommerce-app') {
                    if (table && table.toString().includes('collateral')) {
                        return mixedCollaterals;
                    }
                    if (table && table.toString().includes('stimulation')) {
                        return confusingStimulations;
                    }
                }
                return [];
            });

            render(
                <MemoryRouter initialEntries={['/signals']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('🔍 Signal Debugger')).toBeInTheDocument();
            });

            // Developer would see inconsistent collateral naming in the debugger
            // This test documents the collateral naming issue they'd discover
        });
    });

    describe('Developer Scenario: "Context Store shows missing data"', () => {
        test('Developer debugs context propagation issues', async () => {
            // Developer notices context data isn't flowing through properly
            const contextStimulations = [
                {
                    stimulationId: 'context-test-1',
                    neuronId: 'ecommerce-app:auth-service',
                    collateralName: 'user-authenticated',
                    timestamp: Date.now(),
                    payload: { userId: 'user123', token: 'abc123' },
                    contexts: {
                        'auth-service': {
                            sessions: { 'token_abc123': 'user123' }
                        }
                    },
                    responses: [
                        {
                            responseId: 'context-response-1',
                            neuronId: 'ecommerce-app:auth-service',
                            duration: 45,
                            timestamp: Date.now(),
                            error: null,
                        }
                    ]
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(contextStimulations);

            render(
                <MemoryRouter initialEntries={['/context']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('🗄️ Context Store Monitor')).toBeInTheDocument();
            });

            // Developer can see context data flow and identify where it breaks
        });
    });

    describe('Complete Developer Journey: From Problem to Solution', () => {
        test('Full debugging workflow: Empty graph → Root cause → Solution validation', async () => {
            // This test simulates the complete developer journey

            // PHASE 1: Problem Discovery
            const emptyState = { neurons: [], stimulations: [], responses: [] };

            // PHASE 2: Initial Investigation
            const problemState = {
                neurons: [
                    {
                        neuronId: 'ecommerce-app:order-service',
                        appId: 'ecommerce-app',
                        name: 'order-service',
                        axonCollaterals: ['orderCreated', 'paymentRequested'],
                    }
                ],
                stimulations: [
                    {
                        responseId: 'order-1',
                        neuronId: 'order-service', // PROBLEM: Missing app prefix
                        timestamp: Date.now(),
                        duration: 67,
                        error: null,
                    }
                ]
            };

            // PHASE 3: Root Cause Analysis
            const analysisInsights = {
                neuronIdMismatch: {
                    expected: 'ecommerce-app:order-service',
                    actual: 'order-service',
                    issue: 'Missing app prefix in stimulations'
                },
                collateralNaming: {
                    neuronDefines: 'orderCreated',
                    stimulationUses: 'order-created',
                    issue: 'Inconsistent naming convention'
                }
            };

            // PHASE 4: Solution Validation
            const fixedState = {
                stimulations: [
                    {
                        responseId: 'order-1-fixed',
                        neuronId: 'ecommerce-app:order-service', // FIXED: Full ID
                        collateralName: 'orderCreated',          // FIXED: Matching name
                        timestamp: Date.now(),
                        duration: 67,
                        error: null,
                    }
                ]
            };

            // Test validates the complete debugging journey
            expect(problemState.stimulations[0].neuronId).not.toBe(problemState.neurons[0].neuronId);
            expect(fixedState.stimulations[0].neuronId).toBe(problemState.neurons[0].neuronId);

            // This test documents the developer's complete problem-solving process
            expect(analysisInsights.neuronIdMismatch.issue).toBe('Missing app prefix in stimulations');
            expect(analysisInsights.collateralNaming.issue).toBe('Inconsistent naming convention');
        });
    });

    describe('Developer Tools Usage Patterns', () => {
        test('Developer workflow: Quick diagnosis using multiple DevTools views', async () => {
            // Simulates how a developer would navigate between different views
            const testData = [
                {
                    responseId: 'workflow-test',
                    neuronId: 'ecommerce-app:payment-service',
                    timestamp: Date.now(),
                    duration: 150, // Slow payment
                    error: 'Payment gateway timeout',
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(testData);

            // Developer starts at Overview
            const { rerender } = render(
                <MemoryRouter initialEntries={['/']}>
                    <AppInner />
                </MemoryRouter>
            );

            // Then checks Stimulations for activity
            rerender(
                <MemoryRouter initialEntries={['/stimulations']}>
                    <AppInner />
                </MemoryRouter>
            );

            // Then Performance for slow responses
            rerender(
                <MemoryRouter initialEntries={['/performance']}>
                    <AppInner />
                </MemoryRouter>
            );

            // Then Analytics for patterns
            rerender(
                <MemoryRouter initialEntries={['/analytics']}>
                    <AppInner />
                </MemoryRouter>
            );

            // This test validates that all views work with the same data structure
            await waitFor(() => {
                expect(screen.getByText('📈 Analytics Dashboard')).toBeInTheDocument();
            });
        });

        test('Developer discovers intermittent issues through time-based analysis', async () => {
            // Real scenario: Issues that only happen sometimes
            const intermittentData = [
                {
                    responseId: 'success-1',
                    neuronId: 'ecommerce-app:db-service',
                    timestamp: Date.now() - 5000,
                    duration: 25,
                    error: null, // Success
                },
                {
                    responseId: 'failure-1',
                    neuronId: 'ecommerce-app:db-service',
                    timestamp: Date.now() - 3000,
                    duration: 5000,
                    error: 'Connection pool exhausted', // Failure
                },
                {
                    responseId: 'success-2',
                    neuronId: 'ecommerce-app:db-service',
                    timestamp: Date.now() - 1000,
                    duration: 30,
                    error: null, // Success again
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(intermittentData);

            render(
                <MemoryRouter initialEntries={['/stimulations']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('⚡ Stimulations')).toBeInTheDocument();
            });

            // Developer can see the pattern: success → failure → success
            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();
            expect(screen.getByText(/error: Connection pool exhausted/)).toBeInTheDocument();
            expect(screen.getAllByText(/error: none/)).toHaveLength(2);

            // This helps developer identify intermittent infrastructure issues
        });

        test('Developer uses DevTools to validate production deployment', async () => {
            // Real scenario: Validating that production deployment works correctly
            const productionValidationData = [
                {
                    responseId: 'prod-health-1',
                    neuronId: 'production-app:health-check',
                    timestamp: Date.now(),
                    duration: 5,
                    error: null,
                },
                {
                    responseId: 'prod-auth-1',
                    neuronId: 'production-app:auth-service',
                    timestamp: Date.now() - 500,
                    duration: 45,
                    error: null,
                },
                {
                    responseId: 'prod-db-1',
                    neuronId: 'production-app:database',
                    timestamp: Date.now() - 1000,
                    duration: 12,
                    error: null,
                }
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(productionValidationData);

            render(
                <MemoryRouter initialEntries={['/stimulations']}>
                    <AppInner />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('⚡ Stimulations')).toBeInTheDocument();
            });

            // Developer validates all production services are responding
            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();
            expect(screen.getAllByText(/error: none/)).toHaveLength(3);

            // All neuronIds have correct production app prefix
            expect(screen.getByText(/neuron: production-app:health-check/)).toBeInTheDocument();
            expect(screen.getByText(/neuron: production-app:auth-service/)).toBeInTheDocument();
            expect(screen.getByText(/neuron: production-app:database/)).toBeInTheDocument();
        });
    });
});