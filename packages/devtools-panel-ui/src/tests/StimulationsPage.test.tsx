import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StimulationsPage from '../ui/StimulationsPage';

// Mock OIMDB React hooks
jest.mock('@oimdb/react', () => ({
    useSelectEntitiesByIndexKey: jest.fn(),
}));

// Mock the database
jest.mock('../model', () => ({
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

describe('StimulationsPage', () => {
    const mockResponses = [
        {
            responseId: 'resp1',
            timestamp: 1634567890000, // Fixed timestamp for consistent testing
            neuronId: 'neuron1',
            duration: 25,
            error: null,
        },
        {
            responseId: 'resp2',
            timestamp: 1634567880000, // Earlier timestamp
            neuronId: 'neuron2',
            duration: 150,
            error: 'Timeout error',
        },
        {
            responseId: 'resp3',
            timestamp: 1634567900000, // Latest timestamp
            neuronId: 'neuron1',
            duration: null,
            error: null,
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Component Rendering', () => {
        test('renders stimulations page header', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText('⚡ Stimulations')).toBeInTheDocument();
        });

        test('displays total response count', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText('Total responses: 3')).toBeInTheDocument();
        });

        test('renders with empty responses', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText('Total responses: 0')).toBeInTheDocument();
            expect(screen.getByText(/No stimulations yet/)).toBeInTheDocument();
        });

        test('applies proper styling to container', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            const { container } = render(<StimulationsPage appId="test-app" />);
            const pageContainer = container.firstChild as HTMLElement;

            expect(pageContainer).toHaveStyle({
                padding: 'var(--spacing-xl)'
            });
        });
    });

    describe('Header Styling', () => {
        test('applies decay theme to header', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="test-app" />);

            const header = screen.getByText('⚡ Stimulations');
            expect(header).toHaveClass('decay-glow');
            expect(header).toHaveStyle({ marginTop: '0' });
        });

        test('includes lightning bolt emoji in header', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText('⚡ Stimulations')).toBeInTheDocument();
        });
    });

    describe('Response List Rendering', () => {
        test('renders response items correctly', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText('id: resp1')).toBeInTheDocument();
            expect(screen.getByText('id: resp2')).toBeInTheDocument();
            expect(screen.getByText('id: resp3')).toBeInTheDocument();
        });

        test('displays neuron IDs correctly', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getAllByText(/neuron: neuron1/)).toHaveLength(2); // neuron1 appears twice in mockResponses
            expect(screen.getByText(/neuron: neuron2/)).toBeInTheDocument();
        });

        test('displays durations correctly', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText(/duration: 25ms/)).toBeInTheDocument();
            expect(screen.getByText(/duration: 150ms/)).toBeInTheDocument();
            expect(screen.getByText(/duration: -ms/)).toBeInTheDocument(); // null duration shows as -
        });

        test('displays errors correctly', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getAllByText(/error: none/)).toHaveLength(2); // appears twice
            expect(screen.getByText(/error: Timeout error/)).toBeInTheDocument();
        });

        test('formats timestamps correctly', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            // Should display formatted times (exact format depends on locale)
            const timeElements = screen.getAllByText(/\d{1,2}:\d{2}:\d{2}/);
            expect(timeElements.length).toBeGreaterThan(0);
        });
    });

    describe('Response Sorting', () => {
        test('sorts responses by timestamp in descending order', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            const responseItems = screen.getAllByText(/id: resp/);

            // Should be sorted newest first (resp3, resp1, resp2)
            expect(responseItems[0]).toHaveTextContent('id: resp3');
            expect(responseItems[1]).toHaveTextContent('id: resp1');
            expect(responseItems[2]).toHaveTextContent('id: resp2');
        });

        test('handles equal timestamps', () => {
            const equalTimestampResponses = [
                {
                    responseId: 'resp1',
                    timestamp: 1634567890000,
                    neuronId: 'neuron1',
                    duration: 25,
                    error: null,
                },
                {
                    responseId: 'resp2',
                    timestamp: 1634567890000, // Same timestamp
                    neuronId: 'neuron2',
                    duration: 30,
                    error: null,
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(equalTimestampResponses);

            render(<StimulationsPage appId="test-app" />);

            // Both should be rendered
            expect(screen.getByText('id: resp1')).toBeInTheDocument();
            expect(screen.getByText('id: resp2')).toBeInTheDocument();
        });
    });

    describe('Response Item Styling', () => {
        test('applies proper styling to response items', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([mockResponses[0]]);

            render(<StimulationsPage appId="test-app" />);

            const responseItem = screen.getByText('id: resp1').parentElement?.parentElement;

            expect(responseItem).toHaveStyle({
                background: 'var(--bg-card)',
                border: '1px solid var(--border-accent)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--spacing-sm)',
            });
        });

        test('applies flex layout to response header', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([mockResponses[0]]);

            render(<StimulationsPage appId="test-app" />);

            const responseHeader = screen.getByText('id: resp1').parentElement;

            expect(responseHeader).toHaveStyle({
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 'var(--font-size-xs)',
            });
        });

        test('applies secondary text styling to response details', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([mockResponses[0]]);

            render(<StimulationsPage appId="test-app" />);

            const responseDetails = screen.getByText(/neuron: neuron1/);

            expect(responseDetails).toHaveStyle({
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-secondary)',
            });
        });
    });

    describe('Empty State', () => {
        test('shows empty state message when no responses', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText(/No stimulations yet/)).toBeInTheDocument();
            expect(screen.getByText(/Interact with your app/)).toBeInTheDocument();
        });

        test('applies proper styling to empty state', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="test-app" />);

            const emptyStateMessage = screen.getByText(/No stimulations yet/);

            expect(emptyStateMessage).toHaveStyle({
                color: 'var(--text-muted)',
                fontStyle: 'italic',
            });
        });

        test('shows zero count when empty', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText('Total responses: 0')).toBeInTheDocument();
        });
    });

    describe('Data Handling', () => {
        test('handles null/undefined responses gracefully', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(null as any);

            expect(() => {
                render(<StimulationsPage appId="test-app" />);
            }).not.toThrow();

            expect(screen.getByText('Total responses: 0')).toBeInTheDocument();
        });

        test('handles malformed response data', () => {
            const malformedResponses = [
                {
                    responseId: null,
                    timestamp: 'invalid',
                    neuronId: undefined,
                    duration: NaN,
                    error: undefined,
                },
                {
                    responseId: 'valid-resp',
                    timestamp: Date.now(),
                    neuronId: 'valid-neuron',
                    duration: 100,
                    error: null,
                },
            ];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(malformedResponses as any);

            expect(() => {
                render(<StimulationsPage appId="test-app" />);
            }).not.toThrow();

            // Should render valid response
            expect(screen.getByText('id: valid-resp')).toBeInTheDocument();
        });

        test('handles missing duration field', () => {
            const responseWithoutDuration = [{
                responseId: 'resp1',
                timestamp: Date.now(),
                neuronId: 'neuron1',
                // duration: missing
                error: null,
            }];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(responseWithoutDuration as any);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText(/duration: -ms/)).toBeInTheDocument();
        });

        test('handles missing error field', () => {
            const responseWithoutError = [{
                responseId: 'resp1',
                timestamp: Date.now(),
                neuronId: 'neuron1',
                duration: 50,
                // error: missing
            }];

            mockUseSelectEntitiesByIndexKey.mockReturnValue(responseWithoutError as any);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByText(/error: none/)).toBeInTheDocument();
        });
    });

    describe('App ID Integration', () => {
        test('passes correct app ID to useSelectEntitiesByIndexKey', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="test-app-123" />);

            expect(mockUseSelectEntitiesByIndexKey).toHaveBeenCalledWith(
                {indexes: {appId: 'mockIndex'}}, // db.responses
                'mockIndex', // db.responses.indexes.appId
                'test-app-123'
            );
        });

        test('updates when app ID changes', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            const { rerender } = render(<StimulationsPage appId="app1" />);

            expect(mockUseSelectEntitiesByIndexKey).toHaveBeenLastCalledWith(
                {indexes: {appId: 'mockIndex'}},
                'mockIndex',
                'app1'
            );

            rerender(<StimulationsPage appId="app2" />);

            expect(mockUseSelectEntitiesByIndexKey).toHaveBeenLastCalledWith(
                {indexes: {appId: 'mockIndex'}},
                'mockIndex',
                'app2'
            );
        });
    });

    describe('Performance Considerations', () => {
        test('handles large response datasets efficiently', () => {
            const largeResponseDataset = Array.from({ length: 1000 }, (_, i) => ({
                responseId: `resp${i}`,
                timestamp: Date.now() - i * 1000,
                neuronId: `neuron${i % 10}`,
                duration: Math.random() * 1000,
                error: i % 10 === 0 ? 'Test error' : null,
            }));

            mockUseSelectEntitiesByIndexKey.mockReturnValue(largeResponseDataset);

            const startTime = performance.now();
            render(<StimulationsPage appId="test-app" />);
            const endTime = performance.now();

            const renderTime = endTime - startTime;
            expect(renderTime).toBeLessThan(1000); // Should render within 1 second

            expect(screen.getByText('Total responses: 1000')).toBeInTheDocument();
        });

        test('creates immutable copy for sorting', () => {
            const originalResponses = [...mockResponses];
            mockUseSelectEntitiesByIndexKey.mockReturnValue(originalResponses);

            render(<StimulationsPage appId="test-app" />);

            // Original array should not be modified
            expect(originalResponses).toEqual(mockResponses);
        });
    });

    describe('Layout Structure', () => {
        test('uses grid layout for response list', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            const { container } = render(<StimulationsPage appId="test-app" />);

            const gridContainer = container.querySelector('[style*="display: grid"]');
            expect(gridContainer).toBeInTheDocument();
            expect(gridContainer).toHaveStyle({
                display: 'grid',
                gap: 'var(--spacing-sm)',
            });
        });

        test('maintains proper spacing throughout', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            const { container } = render(<StimulationsPage appId="test-app" />);

            const countElement = screen.getByText('Total responses: 0');
            expect(countElement).toHaveStyle({
                color: 'var(--text-secondary)',
                marginBottom: 'var(--spacing-md)',
            });
        });
    });

    describe('Accessibility', () => {
        test('uses proper semantic elements', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
        });

        test('provides meaningful content structure', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue(mockResponses);

            render(<StimulationsPage appId="test-app" />);

            // Each response should have identifiable information
            expect(screen.getByText('id: resp1')).toBeInTheDocument();
            expect(screen.getAllByText(/neuron: neuron1/)).toHaveLength(2); // neuron1 appears twice
        });
    });

    describe('Component Props', () => {
        test('requires appId prop', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            // TypeScript should enforce this, but test runtime behavior
            expect(() => {
                render(<StimulationsPage appId="required-app-id" />);
            }).not.toThrow();
        });

        test('handles empty appId', () => {
            mockUseSelectEntitiesByIndexKey.mockReturnValue([]);

            render(<StimulationsPage appId="" />);

            expect(mockUseSelectEntitiesByIndexKey).toHaveBeenCalledWith(
                {indexes: {appId: 'mockIndex'}},
                'mockIndex',
                ''
            );
        });
    });
});