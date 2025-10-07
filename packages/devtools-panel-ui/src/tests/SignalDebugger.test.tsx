import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SignalDebugger } from '../ui/SignalDebugger';

// Mock the database
jest.mock('../model', () => ({
    db: {
        stimulations: {
            getAll: jest.fn(() => []),
        },
        responses: {
            getAll: jest.fn(() => []),
        },
        neurons: {
            getAll: jest.fn(() => []),
        },
    }
}));

import { db } from '../model';

const mockDb = db as jest.Mocked<typeof db>;

describe('SignalDebugger', () => {
    const mockStimulations = [
        {
            stimulationId: 'stim1',
            timestamp: Date.now() - 5000,
            neuronId: 'neuron1',
            signal: { type: 'user-click', payload: { x: 100, y: 200 } },
            appId: 'test-app',
        },
        {
            stimulationId: 'stim2',
            timestamp: Date.now() - 3000,
            neuronId: 'neuron2',
            signal: { type: 'api-call', payload: { endpoint: '/users' } },
            appId: 'test-app',
        },
        {
            stimulationId: 'stim3',
            timestamp: Date.now() - 1000,
            neuronId: 'neuron1',
            signal: { type: 'timer-event', payload: { interval: 1000 } },
            appId: 'test-app',
        },
    ];

    const mockResponses = [
        {
            responseId: 'resp1',
            timestamp: Date.now() - 4000,
            stimulationId: 'stim1',
            neuronId: 'neuron1',
            success: true,
            responseTime: 50,
            outputSignal: { result: 'processed' },
        },
        {
            responseId: 'resp2',
            timestamp: Date.now() - 2000,
            stimulationId: 'stim2',
            neuronId: 'neuron2',
            success: false,
            responseTime: 200,
            error: 'Network timeout',
        },
    ];

    const mockNeurons = [
        {
            id: 'neuron1',
            name: 'User Input Handler',
            appId: 'test-app',
        },
        {
            id: 'neuron2',
            name: 'API Gateway',
            appId: 'test-app',
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockDb.stimulations.getAll.mockReturnValue(mockStimulations);
        mockDb.responses.getAll.mockReturnValue(mockResponses);
        mockDb.neurons.getAll.mockReturnValue(mockNeurons);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Component Rendering', () => {
        test('renders signal debugger header', () => {
            render(<SignalDebugger />);

            expect(screen.getByText('Signal Debugger')).toBeInTheDocument();
        });

        test('renders signal list', () => {
            render(<SignalDebugger />);

            expect(screen.getByText('Recent Signals')).toBeInTheDocument();
        });

        test('displays signal entries', () => {
            render(<SignalDebugger />);

            expect(screen.getByText('user-click')).toBeInTheDocument();
            expect(screen.getByText('api-call')).toBeInTheDocument();
            expect(screen.getByText('timer-event')).toBeInTheDocument();
        });

        test('shows neuron names for signals', () => {
            render(<SignalDebugger />);

            expect(screen.getByText('User Input Handler')).toBeInTheDocument();
            expect(screen.getByText('API Gateway')).toBeInTheDocument();
        });
    });

    describe('Signal Filtering', () => {
        test('filters signals by type', () => {
            render(<SignalDebugger />);

            const filterInput = screen.getByPlaceholderText('Filter by signal type...');
            fireEvent.change(filterInput, { target: { value: 'user-click' } });

            expect(screen.getByText('user-click')).toBeInTheDocument();
            expect(screen.queryByText('api-call')).not.toBeInTheDocument();
            expect(screen.queryByText('timer-event')).not.toBeInTheDocument();
        });

        test('filters signals by neuron name', () => {
            render(<SignalDebugger />);

            const neuronFilterInput = screen.getByPlaceholderText('Filter by neuron...');
            fireEvent.change(neuronFilterInput, { target: { value: 'API Gateway' } });

            expect(screen.getByText('api-call')).toBeInTheDocument();
            expect(screen.queryByText('user-click')).not.toBeInTheDocument();
        });

        test('case-insensitive filtering', () => {
            render(<SignalDebugger />);

            const filterInput = screen.getByPlaceholderText('Filter by signal type...');
            fireEvent.change(filterInput, { target: { value: 'USER-CLICK' } });

            expect(screen.getByText('user-click')).toBeInTheDocument();
        });

        test('clears filter when input is empty', () => {
            render(<SignalDebugger />);

            const filterInput = screen.getByPlaceholderText('Filter by signal type...');
            fireEvent.change(filterInput, { target: { value: 'user-click' } });
            fireEvent.change(filterInput, { target: { value: '' } });

            expect(screen.getByText('user-click')).toBeInTheDocument();
            expect(screen.getByText('api-call')).toBeInTheDocument();
            expect(screen.getByText('timer-event')).toBeInTheDocument();
        });
    });

    describe('Signal Details', () => {
        test('shows signal details when clicked', () => {
            render(<SignalDebugger />);

            const signalItem = screen.getByText('user-click');
            fireEvent.click(signalItem);

            expect(screen.getByText('Signal Details')).toBeInTheDocument();
            expect(screen.getByText('"type": "user-click"')).toBeInTheDocument();
        });

        test('displays signal payload in JSON format', () => {
            render(<SignalDebugger />);

            const signalItem = screen.getByText('user-click');
            fireEvent.click(signalItem);

            expect(screen.getByText('"x": 100')).toBeInTheDocument();
            expect(screen.getByText('"y": 200')).toBeInTheDocument();
        });

        test('shows response information if available', () => {
            render(<SignalDebugger />);

            const signalItem = screen.getByText('user-click');
            fireEvent.click(signalItem);

            expect(screen.getByText('Response Information')).toBeInTheDocument();
            expect(screen.getByText('Success: ✅')).toBeInTheDocument();
            expect(screen.getByText('Response Time: 50ms')).toBeInTheDocument();
        });

        test('shows error information for failed responses', () => {
            render(<SignalDebugger />);

            const signalItem = screen.getByText('api-call');
            fireEvent.click(signalItem);

            expect(screen.getByText('Success: ❌')).toBeInTheDocument();
            expect(screen.getByText('Error: Network timeout')).toBeInTheDocument();
        });

        test('handles signals without responses', () => {
            render(<SignalDebugger />);

            const signalItem = screen.getByText('timer-event');
            fireEvent.click(signalItem);

            expect(screen.getByText('No response recorded')).toBeInTheDocument();
        });

        test('closes details panel when clicked again', () => {
            render(<SignalDebugger />);

            const signalItem = screen.getByText('user-click');
            fireEvent.click(signalItem);
            expect(screen.getByText('Signal Details')).toBeInTheDocument();

            fireEvent.click(signalItem);
            expect(screen.queryByText('Signal Details')).not.toBeInTheDocument();
        });
    });

    describe('Real-time Updates', () => {
        test('updates signal list when new data arrives', async () => {
            render(<SignalDebugger />);

            expect(screen.getAllByRole('listitem')).toHaveLength(3);

            // Add new stimulation
            const newStimulations = [
                ...mockStimulations,
                {
                    stimulationId: 'stim4',
                    timestamp: Date.now(),
                    neuronId: 'neuron1',
                    signal: { type: 'new-event' },
                    appId: 'test-app',
                },
            ];

            act(() => {
                mockDb.stimulations.getAll.mockReturnValue(newStimulations);
            });

            // Trigger re-render
            await waitFor(() => {
                expect(screen.getByText('new-event')).toBeInTheDocument();
            });
        });

        test('maintains scroll position when updating', async () => {
            render(<SignalDebugger />);

            const signalList = screen.getByRole('list');

            // Mock scroll position
            Object.defineProperty(signalList, 'scrollTop', {
                value: 100,
                writable: true,
            });

            // Add new data
            act(() => {
                mockDb.stimulations.getAll.mockReturnValue([
                    ...mockStimulations,
                    {
                        stimulationId: 'stim4',
                        timestamp: Date.now(),
                        neuronId: 'neuron1',
                        signal: { type: 'new-event' },
                        appId: 'test-app',
                    },
                ]);
            });

            await waitFor(() => {
                expect(screen.getByText('new-event')).toBeInTheDocument();
            });

            // Scroll position should be maintained
            expect(signalList.scrollTop).toBe(100);
        });

        test('auto-scrolls to bottom for new signals when at bottom', async () => {
            render(<SignalDebugger />);

            const signalList = screen.getByRole('list');

            // Mock being at bottom
            Object.defineProperties(signalList, {
                scrollTop: { value: signalList.scrollHeight - signalList.clientHeight, writable: true },
                scrollHeight: { value: 500, writable: true },
                clientHeight: { value: 300, writable: true },
            });

            // Add new data
            act(() => {
                mockDb.stimulations.getAll.mockReturnValue([
                    ...mockStimulations,
                    {
                        stimulationId: 'stim4',
                        timestamp: Date.now(),
                        neuronId: 'neuron1',
                        signal: { type: 'new-event' },
                        appId: 'test-app',
                    },
                ]);
            });

            await waitFor(() => {
                expect(screen.getByText('new-event')).toBeInTheDocument();
            });
        });
    });

    describe('Signal Timestamps', () => {
        test('formats timestamps correctly', () => {
            render(<SignalDebugger />);

            // Should display relative times like "2 seconds ago"
            expect(screen.getByText(/seconds ago/)).toBeInTheDocument();
        });

        test('updates relative timestamps over time', async () => {
            render(<SignalDebugger />);

            const initialText = screen.getByText(/seconds ago/).textContent;

            // Advance time
            act(() => {
                jest.advanceTimersByTime(60000); // 1 minute
            });

            await waitFor(() => {
                const updatedText = screen.getByText(/ago/).textContent;
                expect(updatedText).not.toBe(initialText);
            });
        });

        test('shows absolute timestamps on hover', () => {
            render(<SignalDebugger />);

            const timestampElement = screen.getByText(/seconds ago/);
            fireEvent.mouseEnter(timestampElement);

            expect(timestampElement).toHaveAttribute('title');
        });
    });

    describe('Signal Status Indicators', () => {
        test('shows success indicator for successful signals', () => {
            render(<SignalDebugger />);

            // Signal with successful response should show success indicator
            expect(screen.getByText('✅')).toBeInTheDocument();
        });

        test('shows error indicator for failed signals', () => {
            render(<SignalDebugger />);

            // Signal with failed response should show error indicator
            expect(screen.getByText('❌')).toBeInTheDocument();
        });

        test('shows pending indicator for signals without responses', () => {
            render(<SignalDebugger />);

            // Signal without response should show pending indicator
            expect(screen.getByText('⏳')).toBeInTheDocument();
        });

        test('updates indicators when responses arrive', async () => {
            render(<SignalDebugger />);

            // Initially pending
            expect(screen.getByText('⏳')).toBeInTheDocument();

            // Add response for timer-event
            const newResponses = [
                ...mockResponses,
                {
                    responseId: 'resp3',
                    timestamp: Date.now(),
                    stimulationId: 'stim3',
                    neuronId: 'neuron1',
                    success: true,
                    responseTime: 25,
                    outputSignal: { result: 'timer-processed' },
                },
            ];

            act(() => {
                mockDb.responses.getAll.mockReturnValue(newResponses);
            });

            await waitFor(() => {
                expect(screen.getAllByText('✅')).toHaveLength(2);
            });
        });
    });

    describe('Signal Export', () => {
        test('shows export button', () => {
            render(<SignalDebugger />);

            expect(screen.getByText('Export Signals')).toBeInTheDocument();
        });

        test('exports filtered signals only', () => {
            // Mock URL.createObjectURL and related methods
            global.URL.createObjectURL = jest.fn(() => 'mock-url');
            global.URL.revokeObjectURL = jest.fn();

            const mockLink = {
                href: '',
                download: '',
                click: jest.fn(),
            };
            jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            jest.spyOn(document.body, 'appendChild').mockImplementation();
            jest.spyOn(document.body, 'removeChild').mockImplementation();

            render(<SignalDebugger />);

            const filterInput = screen.getByPlaceholderText('Filter by signal type...');
            fireEvent.change(filterInput, { target: { value: 'user-click' } });

            const exportButton = screen.getByText('Export Signals');
            fireEvent.click(exportButton);

            expect(document.createElement).toHaveBeenCalledWith('a');
            expect(mockLink.click).toHaveBeenCalled();
        });

        test('exports all signals when no filter is applied', () => {
            global.URL.createObjectURL = jest.fn(() => 'mock-url');
            const mockLink = {
                href: '',
                download: '',
                click: jest.fn(),
            };
            jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
            jest.spyOn(document.body, 'appendChild').mockImplementation();
            jest.spyOn(document.body, 'removeChild').mockImplementation();

            render(<SignalDebugger />);

            const exportButton = screen.getByText('Export Signals');
            fireEvent.click(exportButton);

            expect(mockLink.click).toHaveBeenCalled();
        });
    });

    describe('Signal Search', () => {
        test('searches within signal payload', () => {
            render(<SignalDebugger />);

            const searchInput = screen.getByPlaceholderText('Search signals...');
            fireEvent.change(searchInput, { target: { value: '100' } });

            // Should find the signal with x: 100 in payload
            expect(screen.getByText('user-click')).toBeInTheDocument();
            expect(screen.queryByText('api-call')).not.toBeInTheDocument();
        });

        test('searches in multiple fields', () => {
            render(<SignalDebugger />);

            const searchInput = screen.getByPlaceholderText('Search signals...');
            fireEvent.change(searchInput, { target: { value: 'users' } });

            // Should find the signal with '/users' in the endpoint
            expect(screen.getByText('api-call')).toBeInTheDocument();
            expect(screen.queryByText('user-click')).not.toBeInTheDocument();
        });

        test('highlights search matches', () => {
            render(<SignalDebugger />);

            const searchInput = screen.getByPlaceholderText('Search signals...');
            fireEvent.change(searchInput, { target: { value: 'click' } });

            const signalItem = screen.getByText('user-click');
            fireEvent.click(signalItem);

            // The matched text should be highlighted in the details
            expect(screen.getByText('Signal Details')).toBeInTheDocument();
        });
    });

    describe('Performance and Memory Management', () => {
        test('limits displayed signals to prevent performance issues', () => {
            const manyStimulations = Array.from({ length: 200 }, (_, i) => ({
                stimulationId: `stim${i}`,
                timestamp: Date.now() - i * 1000,
                neuronId: 'neuron1',
                signal: { type: `event${i}` },
                appId: 'test-app',
            }));

            mockDb.stimulations.getAll.mockReturnValue(manyStimulations);

            render(<SignalDebugger />);

            // Should limit to around 100 items
            const signalItems = screen.getAllByRole('listitem');
            expect(signalItems.length).toBeLessThanOrEqual(100);
        });

        test('shows load more button when signals are limited', () => {
            const manyStimulations = Array.from({ length: 200 }, (_, i) => ({
                stimulationId: `stim${i}`,
                timestamp: Date.now() - i * 1000,
                neuronId: 'neuron1',
                signal: { type: `event${i}` },
                appId: 'test-app',
            }));

            mockDb.stimulations.getAll.mockReturnValue(manyStimulations);

            render(<SignalDebugger />);

            expect(screen.getByText('Load More')).toBeInTheDocument();
        });

        test('loads more signals when load more is clicked', () => {
            const manyStimulations = Array.from({ length: 200 }, (_, i) => ({
                stimulationId: `stim${i}`,
                timestamp: Date.now() - i * 1000,
                neuronId: 'neuron1',
                signal: { type: `event${i}` },
                appId: 'test-app',
            }));

            mockDb.stimulations.getAll.mockReturnValue(manyStimulations);

            render(<SignalDebugger />);

            const initialCount = screen.getAllByRole('listitem').length;
            const loadMoreButton = screen.getByText('Load More');
            fireEvent.click(loadMoreButton);

            const newCount = screen.getAllByRole('listitem').length;
            expect(newCount).toBeGreaterThan(initialCount);
        });
    });

    describe('Error Handling', () => {
        test('handles database errors gracefully', () => {
            mockDb.stimulations.getAll.mockImplementation(() => {
                throw new Error('Database error');
            });

            expect(() => {
                render(<SignalDebugger />);
            }).not.toThrow();

            expect(screen.getByText('Error loading signals')).toBeInTheDocument();
        });

        test('handles malformed signal data', () => {
            const malformedStimulations = [
                {
                    stimulationId: null,
                    timestamp: 'invalid',
                    neuronId: undefined,
                    signal: null,
                    appId: 'test-app',
                },
            ];

            mockDb.stimulations.getAll.mockReturnValue(malformedStimulations as any);

            expect(() => {
                render(<SignalDebugger />);
            }).not.toThrow();
        });

        test('handles missing neuron data', () => {
            mockDb.neurons.getAll.mockReturnValue([]);

            render(<SignalDebugger />);

            // Should show signal type even without neuron name
            expect(screen.getByText('user-click')).toBeInTheDocument();
        });
    });

    describe('Accessibility', () => {
        test('provides proper ARIA labels', () => {
            render(<SignalDebugger />);

            expect(screen.getByRole('list')).toHaveAttribute('aria-label', 'Signal list');
            expect(screen.getByPlaceholderText('Filter by signal type...')).toHaveAttribute('aria-label', 'Filter signals by type');
        });

        test('supports keyboard navigation', () => {
            render(<SignalDebugger />);

            const firstSignal = screen.getByText('user-click');

            fireEvent.keyDown(firstSignal, { key: 'Enter' });
            expect(screen.getByText('Signal Details')).toBeInTheDocument();

            fireEvent.keyDown(firstSignal, { key: 'Escape' });
            expect(screen.queryByText('Signal Details')).not.toBeInTheDocument();
        });

        test('provides screen reader announcements for status changes', async () => {
            render(<SignalDebugger />);

            // Add a new successful response
            const newResponses = [
                ...mockResponses,
                {
                    responseId: 'resp3',
                    timestamp: Date.now(),
                    stimulationId: 'stim3',
                    neuronId: 'neuron1',
                    success: true,
                    responseTime: 25,
                },
            ];

            act(() => {
                mockDb.responses.getAll.mockReturnValue(newResponses);
            });

            await waitFor(() => {
                expect(screen.getByLabelText(/Signal completed successfully/)).toBeInTheDocument();
            });
        });
    });
});