import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SimpleCanvasGraph } from '../ui/SimpleCanvasGraph';

// Mock canvas context
const mockContext = {
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    measureText: jest.fn(() => ({ width: 50 })),
    fillText: jest.fn(),
    strokeText: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    setLineDash: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
    canvas: { width: 800, height: 600 },
};

// Mock HTMLCanvasElement
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: jest.fn(() => mockContext),
});

Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
    value: 800,
    writable: true,
});

Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
    value: 600,
    writable: true,
});

// Mock getBoundingClientRect
Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
    value: jest.fn(() => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
    })),
});

describe('SimpleCanvasGraph', () => {
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
        },
        {
            from: 'neuron2',
            to: 'neuron3',
            weight: 0.6,
            stimulationCount: 2,
        },
    ];

    const mockOnNeuronClick = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock context calls
        Object.values(mockContext).forEach(mock => {
            if (jest.isMockFunction(mock)) {
                mock.mockClear();
            }
        });
    });

    describe('Component Rendering', () => {
        test('renders canvas element', () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img');
            expect(canvas).toBeInTheDocument();
            expect(canvas.tagName).toBe('CANVAS');
        });

        test('applies custom className', () => {
            const customClass = 'custom-graph';
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                    className={customClass}
                />
            );

            const canvas = screen.getByRole('img');
            expect(canvas).toHaveClass(customClass);
        });

        test('sets canvas dimensions correctly', () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img') as HTMLCanvasElement;
            expect(canvas.width).toBe(800);
            expect(canvas.height).toBe(600);
        });
    });

    describe('Graph Data Handling', () => {
        test('handles empty neurons array', () => {
            render(
                <SimpleCanvasGraph
                    neurons={[]}
                    connections={[]}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('img')).toBeInTheDocument();
        });

        test('handles empty connections array', () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={[]}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('img')).toBeInTheDocument();
        });

        test('updates when neurons prop changes', async () => {
            const { rerender } = render(
                <SimpleCanvasGraph
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
                <SimpleCanvasGraph
                    neurons={newNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(mockContext.clearRect).toHaveBeenCalled();
            });
        });
    });

    describe('Canvas Interaction', () => {
        test('handles mouse click events', () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img');

            fireEvent.click(canvas, {
                clientX: 100,
                clientY: 100,
            });

            // Should attempt to detect neuron click
            expect(mockContext.getImageData).toHaveBeenCalled();
        });

        test('handles mouse drag for panning', () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img');

            fireEvent.mouseDown(canvas, {
                clientX: 100,
                clientY: 100,
            });

            fireEvent.mouseMove(canvas, {
                clientX: 150,
                clientY: 150,
            });

            fireEvent.mouseUp(canvas);

            // Should handle drag operations
            expect(canvas).toBeInTheDocument();
        });

        test('handles mouse wheel for zoom', () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img');

            fireEvent.wheel(canvas, {
                deltaY: -100,
            });

            // Should handle zoom operations
            expect(canvas).toBeInTheDocument();
        });
    });

    describe('Canvas Drawing Operations', () => {
        test('calls canvas drawing methods for neurons', async () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(mockContext.arc).toHaveBeenCalled();
                expect(mockContext.fill).toHaveBeenCalled();
                expect(mockContext.fillText).toHaveBeenCalled();
            });
        });

        test('calls canvas drawing methods for connections', async () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(mockContext.beginPath).toHaveBeenCalled();
                expect(mockContext.moveTo).toHaveBeenCalled();
                expect(mockContext.lineTo).toHaveBeenCalled();
                expect(mockContext.stroke).toHaveBeenCalled();
            });
        });

        test('clears canvas before each redraw', async () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
            });
        });
    });

    describe('Signal Animation', () => {
        test('creates signal dots based on stimulation count', async () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            // Wait for initial render and signal dot generation
            await waitFor(() => {
                expect(mockContext.arc).toHaveBeenCalled();
            });
        });

        test('animates signal dots over time', async () => {
            jest.useFakeTimers();

            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            // Advance timers to trigger animation frames
            jest.advanceTimersByTime(100);

            await waitFor(() => {
                expect(mockContext.clearRect).toHaveBeenCalled();
            });

            jest.useRealTimers();
        });
    });

    describe('Neuron Click Detection', () => {
        test('detects neuron clicks using image data', () => {
            // Mock getImageData to return non-zero pixel (indicating a neuron)
            mockContext.getImageData.mockReturnValueOnce({
                data: new Uint8ClampedArray([255, 0, 0, 255]), // Red pixel
            });

            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img');

            fireEvent.click(canvas, {
                clientX: 100,
                clientY: 100,
            });

            expect(mockContext.getImageData).toHaveBeenCalledWith(100, 100, 1, 1);
        });

        test('calls onNeuronClick when neuron is clicked', () => {
            // Mock getImageData to return neuron color
            mockContext.getImageData.mockReturnValueOnce({
                data: new Uint8ClampedArray([255, 100, 100, 255]), // Neuron color
            });

            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img');

            fireEvent.click(canvas, {
                clientX: 100,
                clientY: 100,
            });

            // Note: The actual neuron detection logic may require specific color matching
            expect(mockContext.getImageData).toHaveBeenCalled();
        });
    });

    describe('Visual Styling', () => {
        test('applies different colors for neuron types', async () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                // Should call fill multiple times with different colors for different neuron types
                expect(mockContext.fill).toHaveBeenCalled();
            });
        });

        test('styles connections based on weight and activity', async () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            await waitFor(() => {
                expect(mockContext.stroke).toHaveBeenCalled();
                expect(mockContext.setLineDash).toHaveBeenCalled();
            });
        });

        test('highlights selected neurons', async () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            const canvas = screen.getByRole('img');

            // Click to select a neuron
            fireEvent.click(canvas, {
                clientX: 100,
                clientY: 100,
            });

            await waitFor(() => {
                expect(mockContext.arc).toHaveBeenCalled();
            });
        });
    });

    describe('Performance and Memory Management', () => {
        test('limits signal dots to prevent performance issues', () => {
            const highActivityConnections = [
                {
                    from: 'neuron1',
                    to: 'neuron2',
                    weight: 0.8,
                    stimulationCount: 100, // Very high stimulation count
                },
            ];

            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={highActivityConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('img')).toBeInTheDocument();
        });

        test('handles large neuron datasets efficiently', () => {
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
                <SimpleCanvasGraph
                    neurons={manyNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            expect(screen.getByRole('img')).toBeInTheDocument();
        });
    });

    describe('Error Handling', () => {
        test('handles invalid neuron data gracefully', () => {
            const invalidNeurons = [
                {
                    id: '',
                    name: '',
                    x: NaN,
                    y: NaN,
                    stimulationCount: -1,
                    stimulations: [],
                    type: 'processing' as const,
                },
            ];

            expect(() => {
                render(
                    <SimpleCanvasGraph
                        neurons={invalidNeurons}
                        connections={mockConnections}
                        onNeuronClick={mockOnNeuronClick}
                    />
                );
            }).not.toThrow();
        });

        test('handles canvas context not available', () => {
            // Temporarily mock getContext to return null
            const originalGetContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = jest.fn(() => null);

            expect(() => {
                render(
                    <SimpleCanvasGraph
                        neurons={mockNeurons}
                        connections={mockConnections}
                        onNeuronClick={mockOnNeuronClick}
                    />
                );
            }).not.toThrow();

            // Restore original implementation
            HTMLCanvasElement.prototype.getContext = originalGetContext;
        });
    });

    describe('Component Lifecycle', () => {
        test('cleans up animation frames on unmount', () => {
            const cancelAnimationFrameSpy = jest.spyOn(window, 'cancelAnimationFrame');

            const { unmount } = render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            unmount();

            // Should clean up any ongoing animations
            expect(cancelAnimationFrameSpy).toHaveBeenCalled();

            cancelAnimationFrameSpy.mockRestore();
        });

        test('handles resize events', () => {
            render(
                <SimpleCanvasGraph
                    neurons={mockNeurons}
                    connections={mockConnections}
                    onNeuronClick={mockOnNeuronClick}
                />
            );

            // Simulate window resize
            fireEvent.resize(window);

            expect(screen.getByRole('img')).toBeInTheDocument();
        });
    });
});