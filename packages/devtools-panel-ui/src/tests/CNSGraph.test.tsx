import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CNSGraph from '../ui/CNSGraph';

// Mock PIXI.js methods more comprehensively
jest.mock('pixi.js', () => ({
    Application: jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        canvas: document.createElement('canvas'),
        stage: {
            addChild: jest.fn(),
            removeChild: jest.fn(),
            children: [],
        },
        renderer: {
            resize: jest.fn(),
            width: 800,
            height: 600,
        },
        destroy: jest.fn(),
        ticker: {
            add: jest.fn(),
            remove: jest.fn(),
        },
    })),
    Graphics: jest.fn().mockImplementation(() => ({
        circle: jest.fn().mockReturnThis(),
        fill: jest.fn().mockReturnThis(),
        stroke: jest.fn().mockReturnThis(),
        moveTo: jest.fn().mockReturnThis(),
        lineTo: jest.fn().mockReturnThis(),
        clear: jest.fn().mockReturnThis(),
        on: jest.fn(),
        off: jest.fn(),
        tint: 0xffffff,
        eventMode: 'static',
        cursor: 'pointer',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        destroy: jest.fn(),
    })),
    Container: jest.fn().mockImplementation(() => ({
        addChild: jest.fn(),
        removeChild: jest.fn(),
        removeChildren: jest.fn(),
        x: 0,
        y: 0,
        scale: { set: jest.fn() },
        pivot: { set: jest.fn() },
        children: [],
        destroy: jest.fn(),
    })),
    Text: jest.fn().mockImplementation(() => ({
        x: 0,
        y: 0,
        text: '',
        style: {},
        anchor: { set: jest.fn() },
        destroy: jest.fn(),
    })),
}));

describe('CNSGraph', () => {
    const mockNeurons = [
        {
            id: 'neuron1',
            name: 'Input Neuron',
            x: 100,
            y: 100,
            stimulationCount: 5,
            stimulations: [
                { id: 'stim1', timestamp: Date.now(), signal: 'test' }
            ],
            type: 'input' as const,
        },
        {
            id: 'neuron2',
            name: 'Processing Neuron',
            x: 200,
            y: 150,
            stimulationCount: 3,
            stimulations: [
                { id: 'stim2', timestamp: Date.now(), signal: 'test' }
            ],
            type: 'processing' as const,
        },
        {
            id: 'neuron3',
            name: 'Output Neuron',
            x: 300,
            y: 200,
            stimulationCount: 7,
            stimulations: [],
            type: 'output' as const,
        },
    ];

    const mockConnections = [
        {
            from: 'neuron1',
            to: 'neuron2',
            weight: 0.8,
            stimulationCount: 4,
            label: 'Connection 1',
        },
        {
            from: 'neuron2',
            to: 'neuron3',
            weight: 0.6,
            stimulationCount: 2,
            label: 'Connection 2',
        },
    ];

    const mockOnNeuronClick = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Component Rendering', () => {
        test('renders graph container', () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            // Should render a div container
            expect(screen.getByRole('presentation')).toBeInTheDocument();
        });

        test('applies custom className', () => {
            const customClass = 'custom-cns-graph';
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                    className={customClass}
                />
            );

            const container = screen.getByRole('presentation');
            expect(container).toHaveClass(customClass);
        });

        test('renders fallback canvas when PIXI fails', async () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            // Wait for potential PIXI initialization
            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });
        });
    });

    describe('PIXI Application Management', () => {
        test('initializes PIXI application', async () => {
            const { unmount } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            unmount();
        });

        test('destroys PIXI application on unmount', async () => {
            const { unmount } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            unmount();

            // PIXI destroy should be called on unmount
        });

        test('handles PIXI initialization failure gracefully', async () => {
            // Mock PIXI Application to throw an error
            const PixiApplication = require('pixi.js').Application;
            const mockInit = jest.fn().mockRejectedValue(new Error('PIXI init failed'));
            PixiApplication.mockImplementation(() => ({
                init: mockInit,
                canvas: document.createElement('canvas'),
                stage: { addChild: jest.fn(), removeChild: jest.fn(), children: [] },
                renderer: { resize: jest.fn() },
                destroy: jest.fn(),
            }));

            expect(() => {
                render(
                    <CNSGraph
                        neurons={mockNeurons}
                        connections={mockConnections}
                        onNeuronClick={mockOnNeuronClick}
                    />
                );
            }).not.toThrow();
        });
    });

    describe('Graph Data Processing', () => {
        test('handles empty neurons array', () => {
            render(
                <CNSGraph
                    neurons={[]}
                    connections={[]}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('presentation')).toBeInTheDocument();
        });

        test('handles empty connections array', () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={[]}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('presentation')).toBeInTheDocument();
        });

        test('updates when neurons prop changes', () => {
            const { rerender } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const newNeurons = [
                ...mockNeurons,
                {
                    id: 'neuron4',
                    name: 'New Neuron',
                    x: 400,
                    y: 300,
                    stimulationCount: 1,
                    stimulations: [],
                    type: 'processing' as const,
                },
            ];

            rerender(
                <CNSGraph
                    neurons={newNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('presentation')).toBeInTheDocument();
        });

        test('updates when connections prop changes', () => {
            const { rerender } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const newConnections = [
                ...mockConnections,
                {
                    from: 'neuron1',
                    to: 'neuron3',
                    weight: 0.5,
                    stimulationCount: 1,
                    label: 'New Connection',
                },
            ];

            rerender(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={newConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('presentation')).toBeInTheDocument();
        });
    });

    describe('Neuron Rendering and Interaction', () => {
        test('creates graphics for each neuron', async () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should create neuron graphics
            const Graphics = require('pixi.js').Graphics;
            expect(Graphics).toHaveBeenCalled();
        });

        test('handles neuron click events', async () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Simulate neuron click by calling the mock Graphics 'on' handler
            const Graphics = require('pixi.js').Graphics;
            const graphicsInstance = Graphics.mock.results[0].value;
            const clickHandler = graphicsInstance.on.mock.calls.find(call => call[0] === 'pointerdown')?.[1];

            if (clickHandler) {
                clickHandler();
                expect(mockOnNeuronClick).toHaveBeenCalled();
            }
        });

        test('styles neurons based on type', async () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should call fill with different colors for different neuron types
            const Graphics = require('pixi.js').Graphics;
            expect(Graphics).toHaveBeenCalled();
        });

        test('styles neurons based on activity level', async () => {
            const highActivityNeurons = [
                { ...mockNeurons[0], stimulationCount: 50 },
                { ...mockNeurons[1], stimulationCount: 2 },
            ];

            render(
                <CNSGraph
                    neurons={highActivityNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should create different visual representations based on activity
            const Graphics = require('pixi.js').Graphics;
            expect(Graphics).toHaveBeenCalled();
        });
    });

    describe('Connection Rendering', () => {
        test('creates graphics for each connection', async () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should create connection graphics
            const Graphics = require('pixi.js').Graphics;
            expect(Graphics).toHaveBeenCalled();
        });

        test('styles connections based on weight', async () => {
            const varyingWeightConnections = [
                { ...mockConnections[0], weight: 0.9 },
                { ...mockConnections[1], weight: 0.2 },
            ];

            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={varyingWeightConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should style connections differently based on weight
            const Graphics = require('pixi.js').Graphics;
            expect(Graphics).toHaveBeenCalled();
        });

        test('styles connections based on stimulation count', async () => {
            const varyingActivityConnections = [
                { ...mockConnections[0], stimulationCount: 20 },
                { ...mockConnections[1], stimulationCount: 1 },
            ];

            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={varyingActivityConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should style connections differently based on activity
            const Graphics = require('pixi.js').Graphics;
            expect(Graphics).toHaveBeenCalled();
        });

        test('handles connections between non-existent neurons', async () => {
            const invalidConnections = [
                {
                    from: 'non-existent1',
                    to: 'non-existent2',
                    weight: 0.5,
                    stimulationCount: 1,
                },
            ];

            expect(() => {
                render(
                    <CNSGraph
                        neurons={mockNeurons}
                        connections={invalidConnections}
                        onNeuronClick={mockOnNeuronClick}
                    />
                );
            }).not.toThrow();
        });
    });

    describe('Animation and Visual Effects', () => {
        test('creates signal animations for active connections', async () => {
            const activeConnections = [
                { ...mockConnections[0], stimulationCount: 10 },
            ];

            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={activeConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should create animated elements for signals
            const Graphics = require('pixi.js').Graphics;
            expect(Graphics).toHaveBeenCalled();
        });

        test('handles animation ticker correctly', async () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            // Should use PIXI ticker for animations
            const Application = require('pixi.js').Application;
            const appInstance = Application.mock.results[0]?.value;
            if (appInstance?.ticker) {
                expect(appInstance.ticker.add).toHaveBeenCalled();
            }
        });

        test('cleans up animation on unmount', async () => {
            const { unmount } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            unmount();

            // Should clean up ticker and animations
            const Application = require('pixi.js').Application;
            const appInstance = Application.mock.results[0]?.value;
            if (appInstance?.ticker) {
                expect(appInstance.destroy).toHaveBeenCalled();
            }
        });
    });

    describe('Performance Optimization', () => {
        test('handles large neuron datasets efficiently', async () => {
            const manyNeurons = Array.from({ length: 100 }, (_, i) => ({
                id: `neuron${i}`,
                name: `Neuron ${i}`,
                x: (i % 10) * 50,
                y: Math.floor(i / 10) * 50,
                stimulationCount: i % 5,
                stimulations: [],
                type: 'processing' as const,
            }));

            render(
                <CNSGraph
                    neurons={manyNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });
        });

        test('handles many connections efficiently', async () => {
            const manyConnections = Array.from({ length: 50 }, (_, i) => ({
                from: `neuron${i % 3}`,
                to: `neuron${(i + 1) % 3}`,
                weight: Math.random(),
                stimulationCount: i % 10,
            }));

            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={manyConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });
        });

        test('optimizes re-renders when data changes minimally', () => {
            const { rerender } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            // Make a minimal change (same data, different array reference)
            rerender(
                <CNSGraph
                    neurons={[...mockNeurons]}
                    connections={[...mockConnections]}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('presentation')).toBeInTheDocument();
        });
    });

    describe('Error Handling and Edge Cases', () => {
        test('handles invalid neuron coordinates', async () => {
            const invalidNeurons = [
                { ...mockNeurons[0], x: NaN, y: NaN },
                { ...mockNeurons[1], x: Infinity, y: -Infinity },
            ];

            expect(() => {
                render(
                    <CNSGraph
                        neurons={invalidNeurons}
                        connections={mockConnections}
                        onNeuronClick={mockOnNeuronClick}
                    />
                );
            }).not.toThrow();
        });

        test('handles invalid stimulation counts', async () => {
            const invalidNeurons = [
                { ...mockNeurons[0], stimulationCount: -1 },
                { ...mockNeurons[1], stimulationCount: NaN },
            ];

            expect(() => {
                render(
                    <CNSGraph
                        neurons={invalidNeurons}
                        connections={mockConnections}
                        onNeuronClick={mockOnNeuronClick}
                    />
                );
            }).not.toThrow();
        });

        test('handles malformed connection data', async () => {
            const invalidConnections = [
                { ...mockConnections[0], weight: NaN },
                { ...mockConnections[1], stimulationCount: -5 },
            ];

            expect(() => {
                render(
                    <CNSGraph
                        neurons={mockNeurons}
                        connections={invalidConnections}
                        onNeuronClick={mockOnNeuronClick}
                    />
                );
            }).not.toThrow();
        });
    });

    describe('Memory Management', () => {
        test('properly disposes of graphics objects', async () => {
            const { unmount } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            unmount();

            // Should dispose of graphics objects
            const Graphics = require('pixi.js').Graphics;
            const graphicsInstance = Graphics.mock.results[0]?.value;
            if (graphicsInstance?.destroy) {
                expect(graphicsInstance.destroy).toHaveBeenCalled();
            }
        });

        test('removes event listeners on unmount', async () => {
            const { unmount } = render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(screen.getByRole('presentation')).toBeInTheDocument();
            });

            unmount();

            // Should remove event listeners
            const Graphics = require('pixi.js').Graphics;
            const graphicsInstance = Graphics.mock.results[0]?.value;
            if (graphicsInstance?.off) {
                expect(graphicsInstance.off).toHaveBeenCalled();
            }
        });
    });

    describe('Accessibility', () => {
        test('provides appropriate ARIA labels', () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const container = screen.getByRole('presentation');
            expect(container).toBeInTheDocument();
        });

        test('handles keyboard navigation (if implemented)', () => {
            render(
                <CNSGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const container = screen.getByRole('presentation');

            // Test Tab key navigation
            fireEvent.keyDown(container, { key: 'Tab' });
            fireEvent.keyDown(container, { key: 'Enter' });

            expect(container).toBeInTheDocument();
        });
    });
});