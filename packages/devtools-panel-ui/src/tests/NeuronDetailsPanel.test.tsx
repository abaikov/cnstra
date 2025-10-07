import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NeuronDetailsPanel } from '../ui/NeuronDetailsPanel';

describe('NeuronDetailsPanel', () => {
    const mockNeuron = {
        id: 'neuron1',
        name: 'User Input Handler',
        x: 100,
        y: 200,
        stimulationCount: 15,
        stimulations: [
            {
                id: 'stim1',
                timestamp: Date.now() - 5000,
                signal: { type: 'click', x: 100, y: 200 },
                sourceNeuron: 'ui-layer',
                targetNeuron: 'neuron1',
            },
            {
                id: 'stim2',
                timestamp: Date.now() - 3000,
                signal: { type: 'keypress', key: 'Enter' },
                sourceNeuron: 'input-handler',
                targetNeuron: 'neuron1',
            },
        ],
        type: 'input' as const,
    };

    const mockOnClose = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Component Rendering', () => {
        test('renders when neuron is provided', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Neuron Details')).toBeInTheDocument();
            expect(screen.getByText('User Input Handler')).toBeInTheDocument();
        });

        test('returns null when neuron is null', () => {
            const { container } = render(
                <NeuronDetailsPanel
                    neuron={null}
                    onClose={mockOnClose}
                />
            );

            expect(container.firstChild).toBeNull();
        });

        test('applies custom className', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                    className="custom-panel"
                />
            );

            const panel = screen.getByRole('dialog');
            expect(panel).toHaveClass('custom-panel');
        });

        test('displays close button', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByLabelText('Close panel')).toBeInTheDocument();
        });
    });

    describe('Neuron Basic Information', () => {
        test('displays neuron name', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('User Input Handler')).toBeInTheDocument();
        });

        test('displays neuron ID', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('ID: neuron1')).toBeInTheDocument();
        });

        test('displays neuron type', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Type: input')).toBeInTheDocument();
        });

        test('displays neuron position', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Position: (100, 200)')).toBeInTheDocument();
        });

        test('displays stimulation count', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Total Stimulations: 15')).toBeInTheDocument();
        });
    });

    describe('Activity Level Assessment', () => {
        test('shows inactive status for zero stimulations', () => {
            const inactiveNeuron = { ...mockNeuron, stimulationCount: 0 };

            render(
                <NeuronDetailsPanel
                    neuron={inactiveNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Activity Level: Inactive')).toBeInTheDocument();
            expect(screen.getByText('Status: Healthy')).toBeInTheDocument();
        });

        test('shows low activity for 1-4 stimulations', () => {
            const lowActivityNeuron = { ...mockNeuron, stimulationCount: 3 };

            render(
                <NeuronDetailsPanel
                    neuron={lowActivityNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Activity Level: Low')).toBeInTheDocument();
            expect(screen.getByText('Status: Healthy')).toBeInTheDocument();
        });

        test('shows medium activity for 5-14 stimulations', () => {
            const mediumActivityNeuron = { ...mockNeuron, stimulationCount: 10 };

            render(
                <NeuronDetailsPanel
                    neuron={mediumActivityNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Activity Level: Medium')).toBeInTheDocument();
            expect(screen.getByText('Status: Infected')).toBeInTheDocument();
        });

        test('shows high activity for 15-29 stimulations', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron} // 15 stimulations
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Activity Level: High')).toBeInTheDocument();
            expect(screen.getByText('Status: Infected')).toBeInTheDocument();
        });

        test('shows very high activity for 30-49 stimulations', () => {
            const veryHighActivityNeuron = { ...mockNeuron, stimulationCount: 35 };

            render(
                <NeuronDetailsPanel
                    neuron={veryHighActivityNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Activity Level: Very High')).toBeInTheDocument();
            expect(screen.getByText('Status: Critical')).toBeInTheDocument();
        });

        test('shows critical activity for 50+ stimulations', () => {
            const criticalActivityNeuron = { ...mockNeuron, stimulationCount: 75 };

            render(
                <NeuronDetailsPanel
                    neuron={criticalActivityNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Activity Level: Critical')).toBeInTheDocument();
            expect(screen.getByText('Status: Critical')).toBeInTheDocument();
        });
    });

    describe('Decay Theme Integration', () => {
        test('applies decay theme classes', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            // Should use decay components and styling
            expect(screen.getByRole('dialog')).toHaveClass('decay-panel');
        });

        test('uses decay icons for status indicators', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            // Should display decay-themed icons
            expect(screen.getByText(/🦠|☢️|⚠️|💀/)).toBeInTheDocument();
        });

        test('applies appropriate status colors', () => {
            const healthyNeuron = { ...mockNeuron, stimulationCount: 2 };

            render(
                <NeuronDetailsPanel
                    neuron={healthyNeuron}
                    onClose={mockOnClose}
                />
            );

            const statusElement = screen.getByText('Healthy');
            expect(statusElement).toHaveClass('status-healthy');
        });

        test('shows progress bar for activity level', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const progressBar = screen.getByRole('progressbar');
            expect(progressBar).toBeInTheDocument();
            expect(progressBar).toHaveAttribute('aria-valuenow', '15');
        });
    });

    describe('Recent Stimulations Display', () => {
        test('displays recent stimulations section', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Recent Stimulations')).toBeInTheDocument();
        });

        test('shows stimulation entries', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('click')).toBeInTheDocument();
            expect(screen.getByText('keypress')).toBeInTheDocument();
        });

        test('displays stimulation timestamps', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            // Should show relative timestamps
            expect(screen.getByText(/seconds ago/)).toBeInTheDocument();
        });

        test('shows stimulation sources and targets', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('ui-layer')).toBeInTheDocument();
            expect(screen.getByText('input-handler')).toBeInTheDocument();
        });

        test('handles neurons with no stimulations', () => {
            const neuronWithNoStimulations = { ...mockNeuron, stimulations: [], stimulationCount: 0 };

            render(
                <NeuronDetailsPanel
                    neuron={neuronWithNoStimulations}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('No recent stimulations')).toBeInTheDocument();
        });

        test('limits displayed stimulations to prevent overflow', () => {
            const manyStimulations = Array.from({ length: 20 }, (_, i) => ({
                id: `stim${i}`,
                timestamp: Date.now() - i * 1000,
                signal: { type: `event${i}` },
                sourceNeuron: `source${i}`,
                targetNeuron: 'neuron1',
            }));

            const neuronWithManyStimulations = {
                ...mockNeuron,
                stimulations: manyStimulations,
                stimulationCount: 20
            };

            render(
                <NeuronDetailsPanel
                    neuron={neuronWithManyStimulations}
                    onClose={mockOnClose}
                />
            );

            // Should limit to around 10 most recent stimulations
            const stimulationItems = screen.getAllByText(/event\d+/);
            expect(stimulationItems.length).toBeLessThanOrEqual(10);
        });
    });

    describe('Signal Detail Inspection', () => {
        test('shows expandable signal details', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const expandButton = screen.getByText('Show Signal Details');
            fireEvent.click(expandButton);

            expect(screen.getByText('Signal Payload:')).toBeInTheDocument();
        });

        test('displays signal payload in formatted JSON', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const expandButton = screen.getByText('Show Signal Details');
            fireEvent.click(expandButton);

            expect(screen.getByText('"type": "click"')).toBeInTheDocument();
            expect(screen.getByText('"x": 100')).toBeInTheDocument();
            expect(screen.getByText('"y": 200')).toBeInTheDocument();
        });

        test('collapses signal details when clicked again', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const expandButton = screen.getByText('Show Signal Details');
            fireEvent.click(expandButton);

            expect(screen.getByText('Signal Payload:')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Hide Signal Details'));
            expect(screen.queryByText('Signal Payload:')).not.toBeInTheDocument();
        });

        test('handles complex signal objects', () => {
            const complexSignalNeuron = {
                ...mockNeuron,
                stimulations: [{
                    id: 'stim1',
                    timestamp: Date.now(),
                    signal: {
                        type: 'complex-event',
                        data: {
                            user: { id: 123, name: 'John Doe' },
                            action: { type: 'click', coordinates: { x: 100, y: 200 } },
                            metadata: { timestamp: Date.now(), version: '1.0' }
                        }
                    },
                    sourceNeuron: 'ui',
                    targetNeuron: 'neuron1',
                }]
            };

            render(
                <NeuronDetailsPanel
                    neuron={complexSignalNeuron}
                    onClose={mockOnClose}
                />
            );

            const expandButton = screen.getByText('Show Signal Details');
            fireEvent.click(expandButton);

            expect(screen.getByText('"name": "John Doe"')).toBeInTheDocument();
            expect(screen.getByText('"coordinates"')).toBeInTheDocument();
        });
    });

    describe('User Interaction', () => {
        test('calls onClose when close button is clicked', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const closeButton = screen.getByLabelText('Close panel');
            fireEvent.click(closeButton);

            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        test('calls onClose when escape key is pressed', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const panel = screen.getByRole('dialog');
            fireEvent.keyDown(panel, { key: 'Escape' });

            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        test('calls onClose when backdrop is clicked', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const backdrop = screen.getByRole('dialog').parentElement;
            fireEvent.click(backdrop!);

            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        test('does not close when panel content is clicked', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const panelContent = screen.getByText('Neuron Details');
            fireEvent.click(panelContent);

            expect(mockOnClose).not.toHaveBeenCalled();
        });
    });

    describe('Responsive Design', () => {
        test('applies responsive classes', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const panel = screen.getByRole('dialog');
            expect(panel).toHaveClass('responsive-panel');
        });

        test('scrolls content when it overflows', () => {
            const neuronWithLongName = {
                ...mockNeuron,
                name: 'Very Long Neuron Name That Should Potentially Cause Overflow Issues In Some Layouts'
            };

            render(
                <NeuronDetailsPanel
                    neuron={neuronWithLongName}
                    onClose={mockOnClose}
                />
            );

            const panel = screen.getByRole('dialog');
            expect(panel).toHaveStyle({ overflowY: 'auto' });
        });
    });

    describe('Error Handling', () => {
        test('handles malformed stimulation data gracefully', () => {
            const neuronWithMalformedData = {
                ...mockNeuron,
                stimulations: [
                    {
                        id: null,
                        timestamp: 'invalid',
                        signal: null,
                        sourceNeuron: undefined,
                        targetNeuron: '',
                    },
                ]
            };

            expect(() => {
                render(
                    <NeuronDetailsPanel
                        neuron={neuronWithMalformedData as any}
                        onClose={mockOnClose}
                    />
                );
            }).not.toThrow();
        });

        test('handles missing neuron properties gracefully', () => {
            const incompleteNeuron = {
                id: 'neuron1',
                name: 'Test Neuron',
                // Missing x, y, stimulationCount, stimulations, type
            };

            expect(() => {
                render(
                    <NeuronDetailsPanel
                        neuron={incompleteNeuron as any}
                        onClose={mockOnClose}
                    />
                );
            }).not.toThrow();
        });

        test('handles null or undefined signal data', () => {
            const neuronWithNullSignals = {
                ...mockNeuron,
                stimulations: [
                    {
                        id: 'stim1',
                        timestamp: Date.now(),
                        signal: null,
                        sourceNeuron: 'test',
                        targetNeuron: 'neuron1',
                    },
                ]
            };

            render(
                <NeuronDetailsPanel
                    neuron={neuronWithNullSignals as any}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByText('Recent Stimulations')).toBeInTheDocument();
        });
    });

    describe('Accessibility', () => {
        test('provides proper ARIA attributes', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveAttribute('aria-labelledby');
            expect(dialog).toHaveAttribute('aria-describedby');
        });

        test('manages focus correctly', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const closeButton = screen.getByLabelText('Close panel');
            expect(closeButton).toHaveFocus();
        });

        test('supports keyboard navigation', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const expandButton = screen.getByText('Show Signal Details');

            fireEvent.keyDown(expandButton, { key: 'Enter' });
            expect(screen.getByText('Signal Payload:')).toBeInTheDocument();

            fireEvent.keyDown(screen.getByText('Hide Signal Details'), { key: ' ' });
            expect(screen.queryByText('Signal Payload:')).not.toBeInTheDocument();
        });

        test('provides screen reader friendly content', () => {
            render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByLabelText('Neuron activity level: High')).toBeInTheDocument();
            expect(screen.getByLabelText('Neuron status: Infected')).toBeInTheDocument();
        });

        test('announces activity level changes', () => {
            const { rerender } = render(
                <NeuronDetailsPanel
                    neuron={mockNeuron}
                    onClose={mockOnClose}
                />
            );

            const updatedNeuron = { ...mockNeuron, stimulationCount: 50 };

            rerender(
                <NeuronDetailsPanel
                    neuron={updatedNeuron}
                    onClose={mockOnClose}
                />
            );

            expect(screen.getByLabelText('Activity level changed to Critical')).toBeInTheDocument();
        });
    });

    describe('Performance Optimization', () => {
        test('renders efficiently with large stimulation arrays', () => {
            const manyStimulations = Array.from({ length: 1000 }, (_, i) => ({
                id: `stim${i}`,
                timestamp: Date.now() - i * 1000,
                signal: { type: `event${i}`, data: `data${i}` },
                sourceNeuron: `source${i}`,
                targetNeuron: 'neuron1',
            }));

            const neuronWithManyStimulations = {
                ...mockNeuron,
                stimulations: manyStimulations,
                stimulationCount: 1000
            };

            const startTime = performance.now();

            render(
                <NeuronDetailsPanel
                    neuron={neuronWithManyStimulations}
                    onClose={mockOnClose}
                />
            );

            const endTime = performance.now();
            const renderTime = endTime - startTime;

            // Should render within reasonable time (less than 100ms)
            expect(renderTime).toBeLessThan(100);
        });

        test('virtualization for long stimulation lists', () => {
            const manyStimulations = Array.from({ length: 100 }, (_, i) => ({
                id: `stim${i}`,
                timestamp: Date.now() - i * 1000,
                signal: { type: `event${i}` },
                sourceNeuron: `source${i}`,
                targetNeuron: 'neuron1',
            }));

            const neuronWithManyStimulations = {
                ...mockNeuron,
                stimulations: manyStimulations,
                stimulationCount: 100
            };

            render(
                <NeuronDetailsPanel
                    neuron={neuronWithManyStimulations}
                    onClose={mockOnClose}
                />
            );

            // Should not render all 100 items at once
            const stimulationItems = screen.getAllByText(/event\d+/);
            expect(stimulationItems.length).toBeLessThan(20);
        });
    });
});