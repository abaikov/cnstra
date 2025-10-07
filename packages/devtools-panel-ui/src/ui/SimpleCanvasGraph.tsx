import React, { useEffect, useRef, useState, useCallback } from 'react';

interface NeuronData {
    id: string;
    name: string;
    x: number;
    y: number;
    stimulationCount: number;
    stimulations: StimulationData[];
    type: 'input' | 'processing' | 'output';
}

interface StimulationData {
    id: string;
    timestamp: number;
    signal: unknown;
    sourceNeuron?: string;
    targetNeuron?: string;
}

interface ConnectionData {
    from: string;
    to: string;
    weight: number;
    stimulationCount: number;
}

interface SimpleCanvasGraphProps {
    neurons: NeuronData[];
    connections: ConnectionData[];
    onNeuronClick: (neuron: NeuronData) => void;
    className?: string;
}

export const SimpleCanvasGraph: React.FC<SimpleCanvasGraphProps> = ({
    neurons,
    connections,
    onNeuronClick,
    className = '',
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [selectedNeuron, setSelectedNeuron] = useState<string | null>(null);
    const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [graphData, setGraphData] = useState<{
        neurons: NeuronData[];
        connections: ConnectionData[];
    } | null>(null);

    // Signal animation state
    interface SignalDot {
        connectionId: string;
        progress: number; // 0 to 1 along the line
        speed: number;
    }
    const [signalDots, setSignalDots] = useState<SignalDot[]>([]);

    // Initialize graph data
    useEffect(() => {
        if (neurons.length > 0) {
            setGraphData({ neurons, connections });
        } else {
            setGraphData(null);
        }
    }, [neurons, connections]);

    // Generate signal dots based on stimulation count
    useEffect(() => {
        if (!graphData) return;

        const newSignalDots: SignalDot[] = [];

        graphData.connections.forEach(connection => {
            const connectionId = `${connection.from}-${connection.to}`;
            // More stimulations = more signal dots
            const numDots = Math.min(
                Math.floor(connection.stimulationCount / 3),
                8
            );

            for (let i = 0; i < numDots; i++) {
                newSignalDots.push({
                    connectionId,
                    progress: i / numDots + Math.random() * 0.1, // Spread them out
                    speed: 0.008 + Math.random() * 0.004, // Vary speed slightly
                });
            }
        });

        setSignalDots(newSignalDots);
    }, [graphData]);

    // Animation loop for signal dots
    useEffect(() => {
        if (signalDots.length === 0) return;

        const animationFrame = () => {
            setSignalDots(prevDots =>
                prevDots.map(dot => ({
                    ...dot,
                    progress: (dot.progress + dot.speed) % 1, // Loop back when reaching end
                }))
            );
        };

        const intervalId = setInterval(animationFrame, 16); // ~60fps
        return () => clearInterval(intervalId);
    }, [signalDots.length > 0]);

    // Color mapping
    const getNeuronColor = (stimulationCount: number): string => {
        if (stimulationCount === 0) return '#3d2824';
        if (stimulationCount < 5) return '#5c3832';
        if (stimulationCount < 15) return '#7a4940';
        if (stimulationCount < 30) return '#8b7355';
        if (stimulationCount < 50) return '#5c6b47';
        return '#4a5c3a';
    };

    const getConnectionColor = (stimulationCount: number): string => {
        if (stimulationCount === 0) return '#3d2824'; // Dark flesh (theme)
        if (stimulationCount < 10) return '#5c3832'; // Medium flesh (theme)
        if (stimulationCount < 25) return '#7a4940'; // Light flesh (theme)
        return '#8b7355'; // Yellow pus (theme active)
    };

    // Draw function
    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas || !graphData) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#0a0908';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Apply view offset
        ctx.save();
        ctx.translate(viewOffset.x, viewOffset.y);

        // Draw connections
        graphData.connections.forEach(connection => {
            const fromNeuron = graphData.neurons.find(
                n => n.id === connection.from
            );
            const toNeuron = graphData.neurons.find(
                n => n.id === connection.to
            );

            if (fromNeuron && toNeuron) {
                ctx.strokeStyle = getConnectionColor(
                    connection.stimulationCount
                );
                ctx.lineWidth = Math.max(
                    2,
                    Math.min(
                        6,
                        connection.weight * 3 +
                            connection.stimulationCount * 0.1
                    )
                );
                ctx.globalAlpha = 0.9;

                // Draw organic, veiny connection instead of straight line
                const segments = 8;
                const curve = 0.3 + (connection.stimulationCount * 0.02);

                ctx.beginPath();
                ctx.moveTo(fromNeuron.x, fromNeuron.y);

                // Create a slightly curved, organic path
                for (let i = 1; i <= segments; i++) {
                    const t = i / segments;
                    const x = fromNeuron.x + (toNeuron.x - fromNeuron.x) * t;
                    const y = fromNeuron.y + (toNeuron.y - fromNeuron.y) * t;

                    // Add organic curve with some randomness
                    const perpX = -(toNeuron.y - fromNeuron.y);
                    const perpY = toNeuron.x - fromNeuron.x;
                    const perpLength = Math.sqrt(perpX * perpX + perpY * perpY);
                    const normalX = perpX / perpLength;
                    const normalY = perpY / perpLength;

                    const curveOffset = Math.sin(t * Math.PI) * curve * 20;
                    const organicVariation = Math.sin(t * Math.PI * 3) * 3;

                    const finalX = x + normalX * (curveOffset + organicVariation);
                    const finalY = y + normalY * (curveOffset + organicVariation);

                    ctx.lineTo(finalX, finalY);
                }

                ctx.stroke();

                // Draw arrow
                const dx = toNeuron.x - fromNeuron.x;
                const dy = toNeuron.y - fromNeuron.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const unitX = dx / length;
                const unitY = dy / length;

                const arrowX = toNeuron.x - unitX * 12;
                const arrowY = toNeuron.y - unitY * 12;
                const arrowSize = 4;

                ctx.beginPath();
                ctx.moveTo(arrowX, arrowY);
                ctx.lineTo(
                    arrowX - unitX * arrowSize - unitY * arrowSize,
                    arrowY - unitY * arrowSize + unitX * arrowSize
                );
                ctx.moveTo(arrowX, arrowY);
                ctx.lineTo(
                    arrowX - unitX * arrowSize + unitY * arrowSize,
                    arrowY - unitY * arrowSize - unitX * arrowSize
                );
                ctx.stroke();

                ctx.globalAlpha = 1;
            }
        });

        // Draw signal dots
        signalDots.forEach(dot => {
            const connectionId = dot.connectionId;
            const [fromId, toId] = connectionId.split('-');

            const fromNeuron = graphData.neurons.find(n => n.id === fromId);
            const toNeuron = graphData.neurons.find(n => n.id === toId);

            if (fromNeuron && toNeuron) {
                // Calculate position along the line based on progress
                const x =
                    fromNeuron.x + (toNeuron.x - fromNeuron.x) * dot.progress;
                const y =
                    fromNeuron.y + (toNeuron.y - fromNeuron.y) * dot.progress;

                // Draw signal dot
                ctx.fillStyle = '#ffb86c';
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, 2 * Math.PI);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        });

        // Draw neurons with decayed/organic aesthetic
        graphData.neurons.forEach((neuron, index) => {
            const baseRadius = neuron.type === 'input' ? 12 : neuron.type === 'output' ? 15 : 10;
            const activityMultiplier = 1 + (neuron.stimulationCount * 0.02);
            const radius = baseRadius * activityMultiplier;

            // Create organic, infected blob shape instead of perfect circle
            const blobPoints = 8;
            const irregularity = 0.3 + (neuron.stimulationCount * 0.01);

            ctx.fillStyle = getNeuronColor(neuron.stimulationCount);
            ctx.beginPath();

            // Draw irregular blob shape
            for (let i = 0; i <= blobPoints; i++) {
                const angle = (i / blobPoints) * 2 * Math.PI;
                const variance = 1 + (Math.sin(angle * 3 + index) * irregularity);
                const x = neuron.x + Math.cos(angle) * radius * variance;
                const y = neuron.y + Math.sin(angle) * radius * variance;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.closePath();
            ctx.fill();

            // Add inner core for highly active neurons (like a festering center)
            if (neuron.stimulationCount > 5) {
                const coreRadius = radius * 0.4;
                const coreColor = neuron.stimulationCount > 30 ? '#ff6b35' : '#d63031';

                ctx.fillStyle = coreColor;
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.arc(neuron.x, neuron.y, coreRadius, 0, 2 * Math.PI);
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            // Pulsating infection glow for highly active neurons
            if (neuron.stimulationCount > 20) {
                const glowRadius = radius + 6 + Math.sin(Date.now() * 0.003 + index) * 3;
                const glowIntensity = 0.3 + Math.sin(Date.now() * 0.005 + index) * 0.2;

                ctx.strokeStyle = neuron.stimulationCount > 50 ? '#74b816' : '#4a5c3a';
                ctx.lineWidth = 2;
                ctx.globalAlpha = glowIntensity;
                ctx.beginPath();
                ctx.arc(neuron.x, neuron.y, glowRadius, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Add veiny connections/tendrils for infected neurons
            if (neuron.stimulationCount > 15) {
                const tendrilCount = Math.min(4, Math.floor(neuron.stimulationCount / 10));
                ctx.strokeStyle = '#3d2824';
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.6;

                for (let i = 0; i < tendrilCount; i++) {
                    const angle = (i / tendrilCount) * 2 * Math.PI + index;
                    const length = radius + 8 + Math.sin(Date.now() * 0.002 + i) * 4;
                    const endX = neuron.x + Math.cos(angle) * length;
                    const endY = neuron.y + Math.sin(angle) * length;

                    ctx.beginPath();
                    ctx.moveTo(neuron.x, neuron.y);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
            }

            // Selection indicator with infected border
            if (selectedNeuron === neuron.id) {
                const selectionRadius = radius + 8;
                ctx.strokeStyle = '#e74c3c';
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.9;

                // Jagged selection border
                ctx.beginPath();
                for (let i = 0; i <= 12; i++) {
                    const angle = (i / 12) * 2 * Math.PI;
                    const variance = 1 + (Math.sin(angle * 5) * 0.2);
                    const x = neuron.x + Math.cos(angle) * selectionRadius * variance;
                    const y = neuron.y + Math.sin(angle) * selectionRadius * variance;

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.closePath();
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Add neuron name label with decay font styling
            if (radius > 8) {
                ctx.fillStyle = '#d4cfc7';
                ctx.font = `${Math.min(10, radius * 0.6)}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.globalAlpha = 0.8;

                // Shorten name if too long
                const displayName = neuron.name.length > 8
                    ? neuron.name.substring(0, 8) + '...'
                    : neuron.name;

                ctx.fillText(displayName, neuron.x, neuron.y + radius + 15);
                ctx.globalAlpha = 1;
            }
        });

        // Draw legend
        const legendItems = [
            { color: '#3d2824', text: 'Inactive (0)' },
            { color: '#5c3832', text: 'Low (1-5)' },
            { color: '#7a4940', text: 'Medium (5-15)' },
            { color: '#8b7355', text: 'High (15-30)' },
            { color: '#5c6b47', text: 'Very High (30-50)' },
            { color: '#4a5c3a', text: 'Critical (50+)' },
        ];

        ctx.font = '10px monospace';
        ctx.fillStyle = '#d4cfc7';
        legendItems.forEach((item, index) => {
            const y = 30 + index * 20;

            // Draw color circle
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.arc(30, y, 6, 0, 2 * Math.PI);
            ctx.fill();

            // Draw text
            ctx.fillStyle = '#d4cfc7';
            ctx.fillText(item.text, 45, y + 4);
        });

        // Restore context
        ctx.restore();
    };

    // Handle mouse events for panning
    const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        setIsDragging(true);
        setDragStart({
            x: event.clientX - viewOffset.x,
            y: event.clientY - viewOffset.y,
        });
        if (canvasRef.current) {
            canvasRef.current.style.cursor = 'grabbing';
        }
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (isDragging) {
            const newOffset = {
                x: event.clientX - dragStart.x,
                y: event.clientY - dragStart.y,
            };
            setViewOffset(newOffset);
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        if (canvasRef.current) {
            canvasRef.current.style.cursor = 'grab';
        }
    };

    // Handle canvas click (for neuron selection)
    const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!graphData || isDragging) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        // Adjust for view offset
        const x = event.clientX - rect.left - viewOffset.x;
        const y = event.clientY - rect.top - viewOffset.y;

        // Find clicked neuron
        for (const neuron of graphData.neurons) {
            const radius =
                neuron.type === 'input' ? 8 : neuron.type === 'output' ? 10 : 6;
            const distance = Math.sqrt(
                (x - neuron.x) ** 2 + (y - neuron.y) ** 2
            );

            if (distance <= radius) {
                setSelectedNeuron(neuron.id);
                onNeuronClick(neuron);
                return;
            }
        }
    };

    // Draw when data changes or selection changes or view offset changes
    useEffect(() => {
        draw();
    }, [graphData, selectedNeuron, signalDots, viewOffset]);

    // Handle resize
    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            if (!canvas || !canvas.parentElement) return;

            canvas.width = canvas.parentElement.clientWidth || 800;
            canvas.height = canvas.parentElement.clientHeight || 600;
            draw();
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className={`simple-canvas-graph ${className}`}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
                width: '100%',
                height: '100%',
                minHeight: '400px',
                cursor: isDragging ? 'grabbing' : 'grab',
                imageRendering: 'pixelated',
                userSelect: 'none',
            }}
        />
    );
};

export default SimpleCanvasGraph;
