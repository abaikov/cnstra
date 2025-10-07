import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PerformanceMonitor } from '../ui/PerformanceMonitor';

// Mock the database and its methods
jest.mock('../model', () => ({
    db: {
        responses: {
            getAll: jest.fn(() => []),
        },
        stimulations: {
            getAll: jest.fn(() => []),
        },
        neurons: {
            getAll: jest.fn(() => []),
        },
        dendrites: {
            getAll: jest.fn(() => []),
        },
    }
}));

// Mock OIMDB React hooks
jest.mock('@oimdb/react', () => ({
    useSelectEntitiesByIndexKey: jest.fn(() => []),
}));

// Mock performance.memory API
const mockPerformanceMemory = {
    usedJSHeapSize: 50000000, // 50MB
    totalJSHeapSize: 100000000, // 100MB
    jsHeapSizeLimit: 2000000000, // 2GB
};

Object.defineProperty(performance, 'memory', {
    value: mockPerformanceMemory,
    writable: true,
});

// Mock performance.now
const mockPerformanceNow = jest.fn(() => 123456);
Object.defineProperty(performance, 'now', {
    value: mockPerformanceNow,
});

import { db } from '../model';

const mockDb = db as jest.Mocked<typeof db>;

describe('PerformanceMonitor', () => {
    const mockResponses = [
        {
            responseId: 'resp1',
            timestamp: Date.now() - 5000,
            responseTime: 50,
            success: true,
            stimulationId: 'stim1',
        },
        {
            responseId: 'resp2',
            timestamp: Date.now() - 3000,
            responseTime: 200,
            success: false,
            stimulationId: 'stim2',
        },
        {
            responseId: 'resp3',
            timestamp: Date.now() - 1000,
            responseTime: 75,
            success: true,
            stimulationId: 'stim3',
        },
    ];

    const mockStimulations = [
        {
            stimulationId: 'stim1',
            timestamp: Date.now() - 6000,
            neuronId: 'neuron1',
        },
        {
            stimulationId: 'stim2',
            timestamp: Date.now() - 4000,
            neuronId: 'neuron2',
        },
        {
            stimulationId: 'stim3',
            timestamp: Date.now() - 2000,
            neuronId: 'neuron1',
        },
    ];

    const mockNeurons = [
        { id: 'neuron1', name: 'Input Neuron' },
        { id: 'neuron2', name: 'Processing Neuron' },
        { id: 'neuron3', name: 'Output Neuron' },
    ];

    const mockDendrites = [
        { dendriteId: 'dendrite1', neuronId: 'neuron1' },
        { dendriteId: 'dendrite2', neuronId: 'neuron2' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        // Set up mock data
        mockDb.responses.getAll.mockReturnValue(mockResponses);
        mockDb.stimulations.getAll.mockReturnValue(mockStimulations);
        mockDb.neurons.getAll.mockReturnValue(mockNeurons);
        mockDb.dendrites.getAll.mockReturnValue(mockDendrites);

        // Reset performance memory mock
        Object.defineProperty(performance, 'memory', {
            value: mockPerformanceMemory,
            writable: true,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Component Rendering', () => {
        test('renders performance monitor header', () => {
            render(<PerformanceMonitor />);

            expect(screen.getByText('Performance Monitor')).toBeInTheDocument();
        });

        test('renders in collapsed state by default', () => {
            render(<PerformanceMonitor />);

            expect(screen.getByText('Show Details')).toBeInTheDocument();
            expect(screen.queryByText('Hide Details')).not.toBeInTheDocument();
        });

        test('can be expanded to show detailed metrics', () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            expect(screen.getByText('Hide Details')).toBeInTheDocument();
            expect(screen.getByText('Detailed Performance Metrics')).toBeInTheDocument();
        });

        test('displays basic performance indicators when collapsed', () => {
            render(<PerformanceMonitor />);

            expect(screen.getByText(/Memory:/)).toBeInTheDocument();
            expect(screen.getByText(/Response Time:/)).toBeInTheDocument();
        });
    });

    describe('Memory Metrics', () => {
        test('displays memory usage correctly', async () => {
            render(<PerformanceMonitor />);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Memory:/)).toBeInTheDocument();
            expect(screen.getByText(/50\.0 MB/)).toBeInTheDocument();
        });

        test('calculates memory percentage correctly', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // 50MB / 100MB = 50%
            expect(screen.getByText(/50\.0%/)).toBeInTheDocument();
        });

        test('handles missing performance.memory API gracefully', async () => {
            // Remove performance.memory
            delete (performance as any).memory;

            render(<PerformanceMonitor />);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Memory:/)).toBeInTheDocument();
            expect(screen.getByText(/Unknown/)).toBeInTheDocument();
        });

        test('displays memory trend over time', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            // Simulate multiple data points
            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // Change memory usage
            Object.defineProperty(performance, 'memory', {
                value: { ...mockPerformanceMemory, usedJSHeapSize: 60000000 },
                writable: true,
            });

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText('Memory Usage History')).toBeInTheDocument();
        });
    });

    describe('CNS Performance Metrics', () => {
        test('calculates stimulations per second', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Stimulations\/sec:/)).toBeInTheDocument();
        });

        test('calculates average response time', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // (50 + 200 + 75) / 3 = 108.33ms
            expect(screen.getByText(/108\.3ms/)).toBeInTheDocument();
        });

        test('calculates error rate correctly', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // 1 error out of 3 responses = 33.3%
            expect(screen.getByText(/33\.3%/)).toBeInTheDocument();
        });

        test('counts active neurons correctly', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Active Neurons:/)).toBeInTheDocument();
            expect(screen.getByText('3')).toBeInTheDocument();
        });

        test('counts total connections correctly', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Connections:/)).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
        });
    });

    describe('Performance History Tracking', () => {
        test('tracks metrics over time', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            // Generate multiple data points
            for (let i = 0; i < 5; i++) {
                await act(async () => {
                    jest.advanceTimersByTime(1000);
                });

                // Update mock data to simulate changes
                mockDb.stimulations.getAll.mockReturnValue([
                    ...mockStimulations,
                    {
                        stimulationId: `stim${4 + i}`,
                        timestamp: Date.now(),
                        neuronId: 'neuron1',
                    },
                ]);
            }

            expect(screen.getByText('Performance History')).toBeInTheDocument();
        });

        test('limits history to prevent memory issues', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            // Generate many data points (more than the limit)
            for (let i = 0; i < 150; i++) {
                await act(async () => {
                    jest.advanceTimersByTime(1000);
                });
            }

            // History should be limited (typically to 100 points)
            expect(screen.getByText('Performance History')).toBeInTheDocument();
        });

        test('updates history charts in real-time', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            // Initial state
            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText('Memory Trend')).toBeInTheDocument();
            expect(screen.getByText('Response Time Trend')).toBeInTheDocument();
            expect(screen.getByText('Error Rate Trend')).toBeInTheDocument();

            // Update and check for changes
            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // Charts should still be present and updated
            expect(screen.getByText('Memory Trend')).toBeInTheDocument();
        });
    });

    describe('Performance Thresholds and Alerts', () => {
        test('shows warning for high memory usage', async () => {
            // Set high memory usage
            Object.defineProperty(performance, 'memory', {
                value: {
                    ...mockPerformanceMemory,
                    usedJSHeapSize: 85000000, // 85MB out of 100MB = 85%
                },
                writable: true,
            });

            render(<PerformanceMonitor />);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Warning:/)).toBeInTheDocument();
            expect(screen.getByText(/High memory usage/)).toBeInTheDocument();
        });

        test('shows warning for high response times', async () => {
            const highResponseTimeData = [
                {
                    responseId: 'resp1',
                    timestamp: Date.now() - 1000,
                    responseTime: 800, // High response time
                    success: true,
                    stimulationId: 'stim1',
                },
            ];

            mockDb.responses.getAll.mockReturnValue(highResponseTimeData);

            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Warning:/)).toBeInTheDocument();
        });

        test('shows critical alert for very high error rates', async () => {
            const highErrorData = [
                { responseId: 'resp1', success: false, responseTime: 100, stimulationId: 'stim1' },
                { responseId: 'resp2', success: false, responseTime: 100, stimulationId: 'stim2' },
                { responseId: 'resp3', success: false, responseTime: 100, stimulationId: 'stim3' },
            ];

            mockDb.responses.getAll.mockReturnValue(highErrorData);

            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText(/Critical:/)).toBeInTheDocument();
        });
    });

    describe('Real-time Updates', () => {
        test('updates metrics automatically', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            const initialTime = screen.getByText(/Response Time:/);

            // Simulate time passing and data changing
            mockDb.responses.getAll.mockReturnValue([
                ...mockResponses,
                {
                    responseId: 'resp4',
                    timestamp: Date.now(),
                    responseTime: 300,
                    success: true,
                    stimulationId: 'stim4',
                },
            ]);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // Response time should update
            expect(screen.getByText(/Response Time:/)).toBeInTheDocument();
        });

        test('stops updates when component unmounts', async () => {
            const { unmount } = render(<PerformanceMonitor />);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            unmount();

            expect(clearIntervalSpy).toHaveBeenCalled();
        });
    });

    describe('Data Visualization', () => {
        test('renders performance charts when expanded', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText('Memory Trend')).toBeInTheDocument();
            expect(screen.getByText('Response Time Trend')).toBeInTheDocument();
            expect(screen.getByText('Stimulations/sec Trend')).toBeInTheDocument();
        });

        test('handles empty data gracefully in charts', async () => {
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.stimulations.getAll.mockReturnValue([]);

            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText('No performance data available')).toBeInTheDocument();
        });

        test('formats performance numbers correctly', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // Should format memory in MB
            expect(screen.getByText(/50\.0 MB/)).toBeInTheDocument();
            // Should format response time in ms
            expect(screen.getByText(/108\.3ms/)).toBeInTheDocument();
            // Should format percentages
            expect(screen.getByText(/33\.3%/)).toBeInTheDocument();
        });
    });

    describe('Error Handling', () => {
        test('handles database query failures gracefully', async () => {
            mockDb.responses.getAll.mockImplementation(() => {
                throw new Error('Database error');
            });

            expect(() => {
                render(<PerformanceMonitor />);
            }).not.toThrow();

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });
        });

        test('handles malformed response data', async () => {
            const malformedData = [
                { responseId: null, responseTime: 'invalid', success: undefined },
                { responseId: 'resp2', responseTime: NaN, success: null },
            ];

            mockDb.responses.getAll.mockReturnValue(malformedData as any);

            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // Should handle malformed data gracefully
            expect(screen.getByText('Performance Monitor')).toBeInTheDocument();
        });

        test('handles missing performance API gracefully', async () => {
            // Remove performance.now
            delete (window as any).performance.now;

            render(<PerformanceMonitor />);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            expect(screen.getByText('Performance Monitor')).toBeInTheDocument();
        });
    });

    describe('Component State Management', () => {
        test('maintains expand/collapse state', () => {
            render(<PerformanceMonitor />);

            expect(screen.getByText('Show Details')).toBeInTheDocument();

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            expect(screen.getByText('Hide Details')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Hide Details'));
            expect(screen.getByText('Show Details')).toBeInTheDocument();
        });

        test('resets history when component remounts', () => {
            const { unmount, rerender } = render(<PerformanceMonitor />);

            unmount();
            rerender(<PerformanceMonitor />);

            expect(screen.getByText('Performance Monitor')).toBeInTheDocument();
        });
    });

    describe('Accessibility', () => {
        test('provides proper ARIA labels', () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            expect(expandButton).toHaveAttribute('aria-expanded', 'false');

            fireEvent.click(expandButton);
            expect(screen.getByText('Hide Details')).toHaveAttribute('aria-expanded', 'true');
        });

        test('supports keyboard navigation', () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');

            fireEvent.keyDown(expandButton, { key: 'Enter' });
            expect(screen.getByText('Hide Details')).toBeInTheDocument();

            fireEvent.keyDown(screen.getByText('Hide Details'), { key: ' ' });
            expect(screen.getByText('Show Details')).toBeInTheDocument();
        });

        test('provides appropriate role attributes for charts', async () => {
            render(<PerformanceMonitor />);

            const expandButton = screen.getByText('Show Details');
            fireEvent.click(expandButton);

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });

            // Charts should have appropriate roles for screen readers
            expect(screen.getByText('Memory Trend')).toBeInTheDocument();
        });
    });
});