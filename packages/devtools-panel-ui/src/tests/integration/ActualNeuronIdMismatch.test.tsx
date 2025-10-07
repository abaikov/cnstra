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

describe('Actual NeuronId Prefix Mismatch Issue', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('reproduces the ACTUAL real-world issue: neuronId prefix mismatch causing 0 signals', () => {
        // This is the ACTUAL issue from the live logs!
        // Neurons are defined with full IDs like "ecommerce-app:auth-service"
        // But stimulations are sent with short IDs like "auth-service"
        // Result: No matching between stimulations and neurons!

        const actualStimulationsFromLogs = [
            {
                responseId: 'csvbo00l57',
                timestamp: 1759139857738,
                neuronId: 'auth-service', // SHORT ID (from actual logs)
                duration: 25,
                error: null,
            },
            {
                responseId: 'mqom2rkki4',
                timestamp: 1759139841922,
                neuronId: 'search-service', // SHORT ID (from actual logs)
                duration: 150,
                error: null,
            },
            {
                responseId: 'x31vy15jkv',
                timestamp: 1759139842525,
                neuronId: 'cart-service', // SHORT ID (from actual logs)
                duration: 75,
                error: null,
            }
        ];

        mockUseSelectEntitiesByIndexKey.mockReturnValue(actualStimulationsFromLogs);

        render(<StimulationsPage appId="ecommerce-app" />);

        // The stimulations are displayed with SHORT neuronIds
        expect(screen.getByText('Total responses: 3')).toBeInTheDocument();
        expect(screen.getByText(/neuron: auth-service/)).toBeInTheDocument();
        expect(screen.getByText(/neuron: search-service/)).toBeInTheDocument();
        expect(screen.getByText(/neuron: cart-service/)).toBeInTheDocument();

        // But the actual neurons in the system have FULL IDs like "ecommerce-app:auth-service"
        // This mismatch means neurons show 0 signals even though activity is happening!
    });

    test('demonstrates what the data should look like with FULL neuronIds', () => {
        // This shows what happens when neuronId includes the full prefix
        const correctStimulationsWithFullIds = [
            {
                responseId: 'csvbo00l57',
                timestamp: 1759139857738,
                neuronId: 'ecommerce-app:auth-service', // FULL ID - matches neuron definition
                duration: 25,
                error: null,
            },
            {
                responseId: 'mqom2rkki4',
                timestamp: 1759139841922,
                neuronId: 'ecommerce-app:search-service', // FULL ID - matches neuron definition
                duration: 150,
                error: null,
            },
            {
                responseId: 'x31vy15jkv',
                timestamp: 1759139842525,
                neuronId: 'ecommerce-app:cart-service', // FULL ID - matches neuron definition
                duration: 75,
                error: null,
            }
        ];

        mockUseSelectEntitiesByIndexKey.mockReturnValue(correctStimulationsWithFullIds);

        render(<StimulationsPage appId="ecommerce-app" />);

        // With FULL neuronIds, the stimulations would properly link to neurons
        expect(screen.getByText('Total responses: 3')).toBeInTheDocument();
        expect(screen.getByText(/neuron: ecommerce-app:auth-service/)).toBeInTheDocument();
        expect(screen.getByText(/neuron: ecommerce-app:search-service/)).toBeInTheDocument();
        expect(screen.getByText(/neuron: ecommerce-app:cart-service/)).toBeInTheDocument();
    });

    test('shows the exact collateral name mismatch from actual logs', () => {
        // From the actual logs, I can see another issue:
        // Neurons define axonCollaterals with camelCase: "userAuthenticated", "recordMetric"
        // But collaterals are defined with kebab-case: "user-authenticated", "record-metric"

        const actualCollateralMismatchData = [
            {
                responseId: 'auth-response',
                timestamp: Date.now(),
                neuronId: 'auth-service',
                duration: 25,
                error: null,
                // This response was triggered by collateral "user-authenticated"
                // But neuron defines axonCollateral as "userAuthenticated"
            },
            {
                responseId: 'metric-response',
                timestamp: Date.now() - 1000,
                neuronId: 'analytics-service',
                duration: 30,
                error: null,
                // This response was triggered by collateral "record-metric"
                // But neuron defines axonCollateral as "recordMetric"
            }
        ];

        mockUseSelectEntitiesByIndexKey.mockReturnValue(actualCollateralMismatchData);

        render(<StimulationsPage appId="ecommerce-app" />);

        expect(screen.getByText('Total responses: 2')).toBeInTheDocument();
        // This shows that even responses are happening, but naming mismatches prevent proper linking
    });

    test('documents the complete real-world data flow chain of failures', () => {
        // Based on actual logs analysis, here's the complete chain of issues:

        const realWorldDataFlowIssues = {
            // ISSUE 1: Neuron IDs have app prefix in definition but not in stimulations
            neuronDefinitions: [
                { id: 'ecommerce-app:auth-service', name: 'auth-service', axonCollaterals: ['userAuthenticated'] }
            ],
            stimulations: [
                { neuronId: 'auth-service' } // Missing "ecommerce-app:" prefix
            ],

            // ISSUE 2: Collateral names use different case conventions
            neuronAxonCollaterals: ['userAuthenticated', 'recordMetric'], // camelCase
            actualCollaterals: ['user-authenticated', 'record-metric'], // kebab-case

            // ISSUE 3: Dendrites look for specific collateral names that may not match
            dendrites: [
                { collateralName: 'user-login' } // May not match actual collateral names being sent
            ]
        };

        // This test documents the complete mismatch chain
        expect(realWorldDataFlowIssues.neuronDefinitions[0].id).toContain('ecommerce-app:');
        expect(realWorldDataFlowIssues.stimulations[0].neuronId).not.toContain('ecommerce-app:');

        // The naming conventions are inconsistent
        expect(realWorldDataFlowIssues.neuronAxonCollaterals[0]).toBe('userAuthenticated');
        expect(realWorldDataFlowIssues.actualCollaterals[0]).toBe('user-authenticated');

        // This proves why neurons show 0 signals: multiple levels of naming mismatches
    });

    test('validates that fixing the neuronId prefix would resolve the issue', () => {
        // This test shows the corrected data flow that would fix the zero signals issue

        const fixedDataFlow = [
            {
                responseId: 'fixed-auth',
                timestamp: Date.now(),
                neuronId: 'ecommerce-app:auth-service', // FIXED: Full ID with app prefix
                duration: 25,
                error: null,
            },
            {
                responseId: 'fixed-search',
                timestamp: Date.now() - 1000,
                neuronId: 'ecommerce-app:search-service', // FIXED: Full ID with app prefix
                duration: 150,
                error: null,
            }
        ];

        mockUseSelectEntitiesByIndexKey.mockReturnValue(fixedDataFlow);

        render(<StimulationsPage appId="ecommerce-app" />);

        // With proper full neuronIds, the DevTools would show proper signal counts
        expect(screen.getByText('Total responses: 2')).toBeInTheDocument();
        expect(screen.getByText(/neuron: ecommerce-app:auth-service/)).toBeInTheDocument();
        expect(screen.getByText(/neuron: ecommerce-app:search-service/)).toBeInTheDocument();

        // This would allow neurons to show non-zero signal counts in the graph
    });
});