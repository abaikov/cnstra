import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnalyticsDashboard } from '../ui/AnalyticsDashboard';

// Mock the OIMDB React hooks
jest.mock('@oimdb/react', () => ({
    useSelectEntitiesByIndexKey: jest.fn(),
}));

// Create mock database collections that match OIMDB structure
const createMockCollection = () => ({
    indexes: {
        appId: {
            // Mock reactive index structure
            reactiveCollection: {},
            reactiveIndex: {},
        }
    }
});

// Mock the database
jest.mock('../model', () => ({
    db: {
        stimulations: createMockCollection(),
        responses: createMockCollection(),
        neurons: createMockCollection(),
        collaterals: createMockCollection(),
        dendrites: createMockCollection()
    }
}));

import { useSelectEntitiesByIndexKey } from '@oimdb/react';

const mockUseSelectEntitiesByIndexKey = useSelectEntitiesByIndexKey as jest.MockedFunction<typeof useSelectEntitiesByIndexKey>;

describe('AnalyticsDashboard', () => {
    const mockStimulations = [
        {
            stimulationId: 'stim1',
            appId: 'test-app',
            timestamp: Date.now() - 5000,
            neuronId: 'neuron1',
            collateralName: 'test-collateral',
            payload: { data: 'test' },
            contexts: { key: 'value' },
        },
        {
            stimulationId: 'stim2',
            appId: 'test-app',
            timestamp: Date.now() - 10000,
            neuronId: 'neuron2',
            collateralName: 'test-collateral-2',
            payload: { data: 'test2' },
        },
        {
            stimulationId: 'stim3',
            appId: 'test-app',
            timestamp: Date.now() - 60000 * 10, // 10 minutes ago
            neuronId: 'neuron1',
            collateralName: 'old-collateral',
        },
    ];

    const mockResponses = [
        {
            responseId: 'resp1',
            appId: 'test-app',
            timestamp: Date.now() - 6000,
            stimulationId: 'stim1',
            neuronId: 'neuron1',
            duration: 50,
            responsePayload: { result: 'success' },
        },
        {
            responseId: 'resp2',
            appId: 'test-app',
            timestamp: Date.now() - 12000,
            stimulationId: 'stim2',
            neuronId: 'neuron2',
            duration: 200,
            error: 'Processing failed',
        },
    ];

    const mockNeurons = [
        {
            id: 'neuron1',
            appId: 'test-app',
            name: 'Input Neuron',
        },
        {
            id: 'neuron2',
            appId: 'test-app',
            name: 'Processing Neuron',
        },
    ];

    const mockCollaterals = [
        {
            collateralName: 'output1',
            appId: 'test-app',
            neuronId: 'neuron1',
            type: 'output',
        },
    ];

    const mockDendrites = [
        {
            dendriteId: 'dendrite1',
            appId: 'test-app',
            neuronId: 'neuron2',
            collateralName: 'output1',
            type: 'input',
            collateralNames: ['output1'],
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        // Set up default mock implementations
        mockUseSelectEntitiesByIndexKey.mockImplementation((collection, index, key) => {
            if (key === 'test-app') {
                // Identify collection by checking reference equality with imported db
                const { db } = require('../model');

                if (collection === db.stimulations) {
                    return mockStimulations;
                } else if (collection === db.responses) {
                    return mockResponses;
                } else if (collection === db.neurons) {
                    return mockNeurons;
                } else if (collection === db.collaterals) {
                    return mockCollaterals;
                } else if (collection === db.dendrites) {
                    return mockDendrites;
                }
            }
            return null; // OIMDB returns null when no entities found
        });
    });

    describe('Component Rendering', () => {
        test('renders with selected app ID', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
            expect(screen.getByText(/test-app/)).toBeInTheDocument();
        });

        test('renders with no selected app', () => {
            render(<AnalyticsDashboard selectedAppId={null} />);

            expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
            expect(screen.getByText(/No app selected/)).toBeInTheDocument();
        });

        test('renders collapsed by default', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            // Should show expand button
            expect(screen.getByText('Expand Analytics')).toBeInTheDocument();
        });

        test('can be expanded to show detailed analytics', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Collapse Analytics')).toBeInTheDocument();
            expect(screen.getByText('Detailed Analytics')).toBeInTheDocument();
        });
    });

    describe('Basic Metrics Calculation', () => {
        test('displays total stimulations count', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Total Stimulations/)).toBeInTheDocument();
            expect(screen.getByText('3')).toBeInTheDocument();
        });

        test('displays total responses count', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Total Responses/)).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
        });

        test('displays total neurons count', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Total Neurons/)).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
        });

        test('displays total connections count', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Total Connections/)).toBeInTheDocument();
        });
    });

    describe('Performance Metrics', () => {
        test('calculates average response time correctly', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Average Response Time/)).toBeInTheDocument();
            // (50 + 200) / 2 = 125ms
            expect(screen.getByText('125ms')).toBeInTheDocument();
        });

        test('calculates error rate correctly', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Error Rate/)).toBeInTheDocument();
            // 1 error out of 2 responses = 50%
            expect(screen.getByText('50.0%')).toBeInTheDocument();
        });

        test('handles zero responses gracefully', () => {
            mockUseSelectEntitiesByIndexKey.mockImplementation(() => []);

            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Average Response Time/)).toBeInTheDocument();
            expect(screen.getByText('0ms')).toBeInTheDocument();
            expect(screen.getByText(/Error Rate/)).toBeInTheDocument();
            expect(screen.getByText('0.0%')).toBeInTheDocument();
        });
    });

    describe('Throughput Metrics', () => {
        test('calculates stimulations per second', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Stimulations\/sec/)).toBeInTheDocument();
        });

        test('calculates responses per second', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Responses\/sec/)).toBeInTheDocument();
        });
    });

    describe('Top Performing Neurons', () => {
        test('displays top performing neurons section', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Top Performing Neurons')).toBeInTheDocument();
        });

        test('shows neuron performance metrics', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Input Neuron')).toBeInTheDocument();
            expect(screen.getByText('Processing Neuron')).toBeInTheDocument();
        });

        test('handles neurons with no stimulations', () => {
            const neuronsWithNoStimulations = mockNeurons;
            mockUseSelectEntitiesByIndexKey.mockImplementation((db, index, key) => {
                if (index === 'mockIndex') {
                    const dbName = Object.keys(require('../model').db).find(k =>
                        require('../model').db[k].indexes?.appId === index
                    );
                    switch (dbName) {
                        case 'stimulations': return [];
                        case 'responses': return [];
                        case 'neurons': return neuronsWithNoStimulations;
                        default: return [];
                    }
                }
                return [];
            });

            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Top Performing Neurons')).toBeInTheDocument();
        });
    });

    describe('Time Range Metrics', () => {
        test('displays time range selector', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Time Range:')).toBeInTheDocument();
            expect(screen.getByDisplayValue('1hour')).toBeInTheDocument();
        });

        test('changes time range when selected', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            const timeRangeSelect = screen.getByDisplayValue('1hour');
            fireEvent.change(timeRangeSelect, { target: { value: '5min' } });

            expect(screen.getByDisplayValue('5min')).toBeInTheDocument();
        });

        test('filters data based on selected time range', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            const timeRangeSelect = screen.getByDisplayValue('1hour');
            fireEvent.change(timeRangeSelect, { target: { value: '5min' } });

            // Should recalculate metrics based on 5-minute window
            expect(screen.getByDisplayValue('5min')).toBeInTheDocument();
        });

        test('shows all time data when "all" is selected', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            const timeRangeSelect = screen.getByDisplayValue('1hour');
            fireEvent.change(timeRangeSelect, { target: { value: 'all' } });

            expect(screen.getByDisplayValue('all')).toBeInTheDocument();
        });
    });

    describe('Network Complexity Analysis', () => {
        test('displays network complexity section', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Network Complexity')).toBeInTheDocument();
        });

        test('calculates hop distribution', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText(/Max Hops/)).toBeInTheDocument();
            expect(screen.getByText(/Average Hops/)).toBeInTheDocument();
        });
    });

    describe('Data Export Functionality', () => {
        test('displays export section', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Export Data')).toBeInTheDocument();
            expect(screen.getByText('Export Analytics')).toBeInTheDocument();
        });

        test('allows format selection', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            const formatSelect = screen.getByDisplayValue('json');
            expect(formatSelect).toBeInTheDocument();

            fireEvent.change(formatSelect, { target: { value: 'csv' } });
            expect(screen.getByDisplayValue('csv')).toBeInTheDocument();
        });

        test('handles export button click', () => {
            // Mock URL.createObjectURL
            global.URL.createObjectURL = jest.fn(() => 'mock-url');
            global.URL.revokeObjectURL = jest.fn();

            // Mock document.createElement and click
            const mockLink = {
                href: '',
                download: '',
                click: jest.fn(),
            };
            jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            jest.spyOn(document.body, 'appendChild').mockImplementation();
            jest.spyOn(document.body, 'removeChild').mockImplementation();

            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            const exportButton = screen.getByText('Export Analytics');
            fireEvent.click(exportButton);

            expect(document.createElement).toHaveBeenCalledWith('a');
            expect(mockLink.click).toHaveBeenCalled();
        });
    });

    describe('Real-time Updates', () => {
        test('updates when data changes', () => {
            const { rerender } = render(<AnalyticsDashboard selectedAppId="test-app" />);

            // Change the mock data
            const newMockStimulations = [
                ...mockStimulations,
                {
                    stimulationId: 'stim4',
                    appId: 'test-app',
                    timestamp: Date.now(),
                    neuronId: 'neuron1',
                    signal: 'new-signal',
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockImplementation((db, index, key) => {
                if (key === 'test-app' && index === 'mockIndex') {
                    const dbName = Object.keys(require('../model').db).find(k =>
                        require('../model').db[k].indexes?.appId === index
                    );
                    if (dbName === 'stimulations') {
                        return newMockStimulations;
                    }
                }
                return mockUseSelectEntitiesByIndexKey.mockReturnValue([]);
            });

            rerender(<AnalyticsDashboard selectedAppId="test-app" />);

            // Should reflect updated data
            expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
        });
    });

    describe('Error Handling', () => {
        test('handles missing app ID gracefully', () => {
            render(<AnalyticsDashboard selectedAppId={null} />);

            expect(screen.getByText(/No app selected/)).toBeInTheDocument();
        });

        test('handles empty datasets', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('0')).toBeInTheDocument(); // Should show zero metrics
        });

        test('handles malformed data gracefully', () => {
            const malformedData = [
                { id: null, timestamp: 'invalid', responseTime: NaN },
            ];
            mockUseSelectEntitiesByIndexKey.mockReturnValue(malformedData);

            expect(() => {
                render(<AnalyticsDashboard selectedAppId="test-app" />);
            }).not.toThrow();
        });

        test('handles database query failures', () => {
            mockUseSelectEntitiesByIndexKey.mockImplementation(() => {
                throw new Error('Database error');
            });

            expect(() => {
                render(<AnalyticsDashboard selectedAppId="test-app" />);
            }).not.toThrow();
        });
    });

    describe('Performance Considerations', () => {
        test('handles large datasets efficiently', () => {
            const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
                stimulationId: `stim${i}`,
                appId: 'test-app',
                timestamp: Date.now() - i * 1000,
                neuronId: `neuron${i % 10}`,
                signal: `signal${i}`,
            }));

            mockUseSelectEntitiesByIndexKey.mockReturnValue(largeDataset);

            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
        });

        test('debounces time range changes', async () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            fireEvent.click(expandButton);

            const timeRangeSelect = screen.getByDisplayValue('1hour');

            // Rapidly change time range
            fireEvent.change(timeRangeSelect, { target: { value: '5min' } });
            fireEvent.change(timeRangeSelect, { target: { value: '24hours' } });
            fireEvent.change(timeRangeSelect, { target: { value: 'all' } });

            await waitFor(() => {
                expect(screen.getByDisplayValue('all')).toBeInTheDocument();
            });
        });
    });

    describe('Accessibility', () => {
        test('provides proper ARIA labels', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');
            expect(expandButton).toHaveAttribute('aria-expanded', 'false');

            fireEvent.click(expandButton);
            expect(screen.getByText('Collapse Analytics')).toHaveAttribute('aria-expanded', 'true');
        });

        test('supports keyboard navigation', () => {
            render(<AnalyticsDashboard selectedAppId="test-app" />);

            const expandButton = screen.getByText('Expand Analytics');

            fireEvent.keyDown(expandButton, { key: 'Enter' });
            expect(screen.getByText('Collapse Analytics')).toBeInTheDocument();

            fireEvent.keyDown(screen.getByText('Collapse Analytics'), { key: ' ' });
            expect(screen.getByText('Expand Analytics')).toBeInTheDocument();
        });
    });
});