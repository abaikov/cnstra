import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import SimpleCanvasGraph from './SimpleCanvasGraph';

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
    label?: string;
}

interface CNSGraphProps {
    neurons: NeuronData[];
    connections: ConnectionData[];
    onNeuronClick: (neuron: NeuronData) => void;
    className?: string;
}

export const CNSGraph: React.FC<CNSGraphProps> = ({
    neurons,
    connections,
    onNeuronClick,
    className = '',
}) => {
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const neuronsContainerRef = useRef<PIXI.Container | null>(null);
    const connectionsContainerRef = useRef<PIXI.Container | null>(null);
    const neuronGraphicsRef = useRef<Map<string, PIXI.Container>>(new Map());
    const connectionsMetaRef = useRef<
        Map<
            string,
            {
                graphic: PIXI.Graphics;
                particles: PIXI.Graphics[];
                ctrl: { x: number; y: number };
                from: { x: number; y: number };
                to: { x: number; y: number };
                speed: number;
            }
        >
    >(new Map());
    const [selectedNeuron, setSelectedNeuron] = useState<string | null>(null);
    const [graphData, setGraphData] = useState<{
        neurons: NeuronData[];
        connections: ConnectionData[];
    } | null>(null);
    const [pixiError, setPixiError] = useState<boolean>(false);
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
    const viewOffsetRef = useRef({ x: 0, y: 0 });
    const [contentBounds, setContentBounds] = useState({
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
    });
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

    // Color mapping based on stimulation activity (brighter colors)
    const getNeuronColor = (stimulationCount: number): number => {
        if (stimulationCount === 0) return 0x6b4940; // Medium flesh (inactive but visible)
        if (stimulationCount < 5) return 0x8b5a52; // Bright flesh
        if (stimulationCount < 15) return 0xb86b63; // Very bright flesh
        if (stimulationCount < 30) return 0xd4a574; // Golden pus
        if (stimulationCount < 50) return 0x8ba85c; // Bright green pus
        return 0x6fb84a; // Bright acid green (highly active)
    };

    const getConnectionColor = (stimulationCount: number): number => {
        if (stimulationCount === 0) return 0x3d2824; // Dark flesh (theme)
        if (stimulationCount < 10) return 0x5c3832; // Medium flesh (theme)
        if (stimulationCount < 25) return 0x7a4940; // Light flesh (theme)
        return 0x8b7355; // Yellow pus (theme active)
    };

    const getBlockSizeForNeuron = (
        neuron: NeuronData
    ): { width: number; height: number } => {
        const baseWidth = neuron.type === 'processing' ? 200 : 180;
        const baseHeight = 80;
        const extra = Math.min(160, Math.max(0, neuron.name.length - 14) * 7);
        return { width: baseWidth + extra, height: baseHeight };
    };

    const createNeuronGraphic = (neuron: NeuronData): PIXI.Container => {
        const container = new PIXI.Container();

        // Create block-style neuron body
        const graphic = new PIXI.Graphics();
        const color = getNeuronColor(neuron.stimulationCount);
        const { width: blockW, height: blockH } = getBlockSizeForNeuron(neuron);

        // Pulse/glow behind block
        const pulse = new PIXI.Graphics();
        pulse
            .roundRect(
                -blockW / 2 - 8,
                -blockH / 2 - 8,
                blockW + 16,
                blockH + 16,
                12
            )
            .stroke({ color: 0xff6b35, width: 2, alpha: 0.35 });
        container.addChild(pulse);

        // Main block with subtle border
        graphic
            .roundRect(-blockW / 2, -blockH / 2, blockW, blockH, 12)
            .fill({ color, alpha: 0.96 })
            .stroke({ color: 0xffffff, width: 1.5, alpha: 0.25 });

        // Make interactive
        graphic.eventMode = 'static';
        graphic.cursor = 'pointer';

        // Store neuron data for later access
        (graphic as any).neuronData = neuron;

        // Add hover effects
        graphic.on('pointerover', () => {
            graphic.tint = 0xdddddd;
        });

        graphic.on('pointerout', () => {
            graphic.tint = 0xffffff;
        });

        graphic.on('pointertap', () => {
            setSelectedNeuron(neuron.id);
            onNeuronClick(neuron);
        });

        // Labels inside block
        const nameText = new PIXI.Text({
            text: neuron.name,
            style: {
                fontFamily: 'Px437_IBM_Conv, monospace',
                fontSize: 12,
                fill: '#f0ece4',
                align: 'center',
                fontWeight: 'bold',
            },
        });
        nameText.anchor.set(0.5, 0.5);
        nameText.position.set(0, -8);

        const metaText = new PIXI.Text({
            text: `stim: ${neuron.stimulationCount}`,
            style: {
                fontFamily: 'Px437_IBM_Conv, monospace',
                fontSize: 10,
                fill: '#c4b8a6',
                align: 'center',
            },
        });
        metaText.anchor.set(0.5, 0.5);
        metaText.position.set(0, 14);

        // Add both graphics and text to container
        container.addChild(graphic);
        container.addChild(nameText);
        container.addChild(metaText);

        // Store neuron data on container too
        (container as any).neuronData = neuron;

        // Animate subtle pulse
        let t = 0;
        const ticker = PIXI.Ticker.shared;
        const update = () => {
            t += 0.02 + Math.min(0.03, neuron.stimulationCount / 2000);
            const scale = 1 + Math.sin(t) * 0.02;
            pulse.scale.set(scale);
            pulse.alpha = 0.12 + (Math.sin(t) + 1) * 0.06;
        };
        ticker.add(update);
        (container as any).__pulseCleanup = () => ticker.remove(update);

        // Store block size for layout/bounds
        (container as any).__blockW = blockW;
        (container as any).__blockH = blockH;

        return container;
    };

    const updateNeuronSelection = (neuronId: string | null) => {
        const neuronContainers = neuronGraphicsRef.current;

        neuronContainers.forEach((container, id) => {
            const graphic = container.getChildAt(1) as PIXI.Graphics; // main block under labels
            const base = container.getChildAt(0) as PIXI.Graphics; // pulse
            const neuron = (container as any).neuronData as NeuronData;
            const color = getNeuronColor(neuron.stimulationCount);
            const { width: blockW, height: blockH } =
                getBlockSizeForNeuron(neuron);

            graphic.clear();
            graphic
                .roundRect(-blockW / 2, -blockH / 2, blockW, blockH, 12)
                .fill({ color })
                .stroke({ color: 0xffffff, width: 1.2, alpha: 0.2 });
            if (neuronId === id) {
                base.clear();
                base.roundRect(
                    -blockW / 2 - 10,
                    -blockH / 2 - 10,
                    blockW + 20,
                    blockH + 20,
                    14
                ).stroke({ color: 0xa83c3c, width: 2, alpha: 0.35 });
            }
        });
    };

    // Quadratic curve helpers
    const computeControlPoint = (
        a: { x: number; y: number },
        b: { x: number; y: number },
        offset = 30
    ) => {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len; // perpendicular normal
        const ny = dx / len;
        return { x: mx + nx * offset, y: my + ny * offset };
    };

    const pointOnQuadratic = (
        t: number,
        p0: { x: number; y: number },
        p1: { x: number; y: number },
        p2: { x: number; y: number }
    ) => {
        const u = 1 - t;
        const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
        const y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
        return { x, y };
    };

    const createConnectionGraphic = (
        connection: ConnectionData,
        fromNeuron: NeuronData,
        toNeuron: NeuronData,
        fanOffset: number
    ): { graphic: PIXI.Graphics; ctrl: { x: number; y: number } } => {
        const graphic = new PIXI.Graphics();
        const color = getConnectionColor(connection.stimulationCount);
        const width = Math.max(
            2,
            Math.min(
                6,
                connection.weight * 3 + connection.stimulationCount * 0.1
            )
        );

        const p0 = { x: fromNeuron.x, y: fromNeuron.y };
        const p2 = { x: toNeuron.x, y: toNeuron.y };
        // Base offset + fan-out contribution
        const ctrl = computeControlPoint(p0, p2, 24 + fanOffset);

        graphic.moveTo(p0.x, p0.y);
        (graphic as any).quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y); // Pixi v8 retains API via Graphics path
        graphic.stroke({ color, width, alpha: 0.9 }); // Much more visible

        // Arrow head (approximate tangent near end)
        const t = 0.92;
        const pPrev = pointOnQuadratic(t - 0.02, p0, ctrl, p2);
        const pEnd = pointOnQuadratic(t, p0, ctrl, p2);
        const dx = pEnd.x - pPrev.x;
        const dy = pEnd.y - pPrev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const arrowX = pEnd.x - ux * 8;
        const arrowY = pEnd.y - uy * 8;
        const arrowSize = 4;
        graphic.moveTo(arrowX, arrowY);
        graphic.lineTo(
            arrowX - ux * arrowSize - uy * arrowSize,
            arrowY - uy * arrowSize + ux * arrowSize
        );
        graphic.moveTo(arrowX, arrowY);
        graphic.lineTo(
            arrowX - ux * arrowSize + uy * arrowSize,
            arrowY - uy * arrowSize - ux * arrowSize
        );
        graphic.stroke({ color, width: width + 1, alpha: 0.8 });

        return { graphic, ctrl };
    };

    // Find connected components to separate graph levels
    const findConnectedComponents = (
        nodes: NeuronData[],
        edges: ConnectionData[]
    ): Array<{ nodes: NeuronData[]; edges: ConnectionData[] }> => {
        const visited = new Set<string>();
        const components: Array<{
            nodes: NeuronData[];
            edges: ConnectionData[];
        }> = [];

        // Build adjacency list
        const adj = new Map<string, Set<string>>();
        nodes.forEach(n => adj.set(n.id, new Set()));
        edges.forEach(e => {
            adj.get(e.from)?.add(e.to);
            adj.get(e.to)?.add(e.from);
        });

        // DFS to find components
        const dfs = (nodeId: string, component: NeuronData[]) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);
            const node = nodes.find(n => n.id === nodeId);
            if (node) component.push(node);

            adj.get(nodeId)?.forEach(neighborId => {
                if (!visited.has(neighborId)) {
                    dfs(neighborId, component);
                }
            });
        };

        nodes.forEach(node => {
            if (!visited.has(node.id)) {
                const component: NeuronData[] = [];
                dfs(node.id, component);
                if (component.length > 0) {
                    const componentEdges = edges.filter(
                        e =>
                            component.some(n => n.id === e.from) &&
                            component.some(n => n.id === e.to)
                    );
                    components.push({
                        nodes: component,
                        edges: componentEdges,
                    });
                }
            }
        });

        return components;
    };

    // Bounding box for neuron collision detection
    interface BoundingBox {
        x: number;
        y: number;
        width: number;
        height: number;
    }

    const getNeuronBoundingBox = (neuron: NeuronData): BoundingBox => {
        const { width: blockW, height: blockH } = getBlockSizeForNeuron(neuron);
        const padding = 24;
        return {
            x: neuron.x - blockW / 2 - padding,
            y: neuron.y - blockH / 2 - padding,
            width: blockW + padding * 2,
            height: blockH + padding * 2,
        };
    };

    const boxesOverlap = (box1: BoundingBox, box2: BoundingBox): boolean => {
        return !(
            box1.x + box1.width <= box2.x ||
            box2.x + box2.width <= box1.x ||
            box1.y + box1.height <= box2.y ||
            box2.y + box2.height <= box1.y
        );
    };

    const resolveCollisions = (neurons: NeuronData[]): void => {
        const maxIterations = 50;
        let iteration = 0;

        while (iteration < maxIterations) {
            let hasCollisions = false;

            for (let i = 0; i < neurons.length; i++) {
                for (let j = i + 1; j < neurons.length; j++) {
                    const neuron1 = neurons[i];
                    const neuron2 = neurons[j];

                    const box1 = getNeuronBoundingBox(neuron1);
                    const box2 = getNeuronBoundingBox(neuron2);

                    if (boxesOverlap(box1, box2)) {
                        hasCollisions = true;

                        // Calculate separation vector
                        const dx = neuron2.x - neuron1.x;
                        const dy = neuron2.y - neuron1.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);

                        if (distance === 0) {
                            // Handle identical positions
                            neuron2.x += 50;
                            neuron2.y += 50;
                        } else {
                            // Minimum separation distance (sum of half-widths + extra padding for dendrites)
                            const minSeparation =
                                (box1.width + box2.width) / 2 + 30;

                            if (distance < minSeparation) {
                                // Normalize direction vector
                                const ux = dx / distance;
                                const uy = dy / distance;

                                // Calculate how much to move each neuron
                                const overlap = minSeparation - distance;
                                const moveDistance = overlap / 2 + 5; // Extra padding

                                // Move both neurons away from each other
                                neuron1.x -= ux * moveDistance;
                                neuron1.y -= uy * moveDistance;
                                neuron2.x += ux * moveDistance;
                                neuron2.y += uy * moveDistance;

                                console.log(
                                    `Resolved collision between ${neuron1.name} and ${neuron2.name}`
                                );
                            }
                        }
                    }
                }
            }

            if (!hasCollisions) {
                console.log(
                    `Collision resolution converged after ${iteration} iterations`
                );
                break;
            }

            iteration++;
        }

        if (iteration >= maxIterations) {
            console.warn(
                'Collision resolution did not converge within maximum iterations'
            );
        }
    };

    const layoutNodes = (
        width: number,
        height: number,
        nodes: NeuronData[]
    ): NeuronData[] => {
        const components = findConnectedComponents(
            nodes,
            graphData?.connections || []
        );
        const componentPadding = 40; // Smaller padding between components
        let currentY = 40; // Start from top

        components.forEach((component, compIndex) => {
            const componentNodes = component.nodes;

            // Layout within component based on node types
            const inputs = componentNodes.filter(n => n.type === 'input');
            const mids = componentNodes.filter(n => n.type === 'processing');
            const outputs = componentNodes.filter(n => n.type === 'output');

            // Calculate height considering cascade layout
            const maxNodesInColumn = Math.max(
                inputs.length,
                mids.length,
                outputs.length
            );
            const baseHeight = 150;
            const heightPerNeuron = maxNodesInColumn > 3 ? 70 : 100; // Tighter for cascade
            const componentHeight = Math.max(
                baseHeight,
                maxNodesInColumn * heightPerNeuron + 100 // Extra padding
            );
            const componentCenterX = width / 2;
            const componentCenterY = currentY + componentHeight / 2;

            const leftX = Math.max(80, componentCenterX - 150);
            const midX = componentCenterX;
            const rightX = Math.min(width - 80, componentCenterX + 150);

            const placeColumn = (
                arr: NeuronData[],
                x: number,
                yBase: number
            ) => {
                // Reserve space for neuron + text: ~100px height per neuron minimum
                const neuronHeight = 100;

                console.log(
                    `Column has ${arr.length} neurons, using collision-aware layout`
                );

                if (arr.length > 1) {
                    // Use collision-aware positioning instead of fixed spacing
                    const spreadX = 200; // Much wider horizontal spread for bigger neurons
                    const minSpreadY = 140; // Much bigger vertical offset per neuron

                    arr.forEach((n, i) => {
                        const offsetX =
                            (i - (arr.length - 1) / 2) *
                            (spreadX / Math.max(1, arr.length - 1));
                        n.x = x + offsetX;
                        n.y = yBase + neuronHeight + i * minSpreadY;
                        console.log(
                            `  Initial neuron ${n.name}: (${n.x}, ${n.y})`
                        );
                    });
                } else {
                    // For single neuron: center it
                    arr.forEach((n, i) => {
                        n.x = x;
                        n.y = yBase + neuronHeight;
                        console.log(
                            `  Single neuron ${n.name}: (${n.x}, ${n.y})`
                        );
                    });
                }
            };

            placeColumn(inputs, leftX, currentY);
            placeColumn(mids, midX, currentY);
            placeColumn(outputs, rightX, currentY);

            // Apply collision detection and resolution to prevent overlaps
            resolveCollisions(componentNodes);

            // Clamp to component bounds
            componentNodes.forEach(n => {
                n.x = Math.max(50, Math.min(width - 50, n.x));
                n.y = Math.max(
                    currentY + 20,
                    Math.min(currentY + componentHeight - 20, n.y)
                );
            });

            // Move to next component level
            currentY += componentHeight + componentPadding;
        });

        // Calculate content bounds for scroll indicators
        const allNodes = nodes;
        if (allNodes.length > 0) {
            const minX = Math.min(...allNodes.map(n => n.x)) - 100;
            const maxX = Math.max(...allNodes.map(n => n.x)) + 100;
            const minY = Math.min(...allNodes.map(n => n.y)) - 50;
            const maxY = Math.max(...allNodes.map(n => n.y)) + 50;

            setContentBounds({
                minX,
                minY,
                maxX,
                maxY,
                width: maxX - minX,
                height: maxY - minY,
            });
        }

        return nodes;
    };

    // Keep internal graph data in sync with props (supports app switching)
    useEffect(() => {
        // Deduplicate neurons by id
        const uniqueMap = new Map<string, NeuronData>();
        neurons.forEach(n => {
            if (!uniqueMap.has(n.id)) uniqueMap.set(n.id, { ...n });
        });
        setGraphData({
            neurons: Array.from(uniqueMap.values()),
            connections,
        });
    }, [neurons, connections]);

    // Create PIXI app and draw graph (only when graph data changes)
    useEffect(() => {
        if (!canvasRef.current || !graphData) return;

        const app = new PIXI.Application();
        let destroyed = false;
        let handleResize: (() => void) | null = null;
        let panHandlers: {
            onPointerDown: (event: PointerEvent) => void;
            onPointerMove: (event: PointerEvent) => void;
            onPointerUp: () => void;
        } | null = null;

        (async () => {
            const width = canvasRef.current!.clientWidth || 800;
            const height = canvasRef.current!.clientHeight || 600;
            setCanvasSize({ width, height });

            try {
                await app.init({
                    width,
                    height,
                    background: '#0a0908',
                    antialias: false,
                    preference: 'webgl',
                    hello: true,
                });
            } catch (error) {
                console.warn(
                    'PixiJS init failed, using Canvas fallback:',
                    error
                );
                setPixiError(true);
                return;
            }

            if (destroyed) return;

            handleResize = () => {
                if (canvasRef.current && app.renderer) {
                    const width = canvasRef.current.clientWidth || 800;
                    const height = canvasRef.current.clientHeight || 600;
                    app.renderer.resize(width, height);
                    setCanvasSize({ width, height });
                }
            };
            window.addEventListener('resize', handleResize);

            canvasRef.current!.appendChild(app.canvas);
            appRef.current = app;

            // Create containers for layering
            const connectionsContainer = new PIXI.Container();
            const neuronsContainer = new PIXI.Container();
            const rootContainer = new PIXI.Container();
            rootContainer.addChild(connectionsContainer);
            rootContainer.addChild(neuronsContainer);
            app.stage.addChild(rootContainer);

            // Apply current view offset
            rootContainer.position.set(
                viewOffsetRef.current.x,
                viewOffsetRef.current.y
            );

            connectionsContainerRef.current = connectionsContainer;
            neuronsContainerRef.current = neuronsContainer;

            // Enable panning functionality
            let isDragging = false;
            let dragStart = { x: 0, y: 0 };

            const onPointerDown = (event: PointerEvent) => {
                isDragging = true;
                dragStart.x = event.clientX - viewOffsetRef.current.x;
                dragStart.y = event.clientY - viewOffsetRef.current.y;
                setIsPanning(true);
                setPanStart({ x: event.clientX, y: event.clientY });
                app.canvas.style.cursor = 'grabbing';
            };

            const onPointerMove = (event: PointerEvent) => {
                if (!isDragging) return;
                const newOffset = {
                    x: event.clientX - dragStart.x,
                    y: event.clientY - dragStart.y,
                };
                viewOffsetRef.current = newOffset;
                setViewOffset(newOffset);
                rootContainer.position.set(newOffset.x, newOffset.y);
            };

            const onPointerUp = () => {
                isDragging = false;
                setIsPanning(false);
                app.canvas.style.cursor = 'grab';
            };

            // Store handlers for cleanup
            panHandlers = { onPointerDown, onPointerMove, onPointerUp };

            // Add event listeners
            app.canvas.style.cursor = 'grab';
            app.canvas.addEventListener('pointerdown', onPointerDown);
            app.canvas.addEventListener('pointermove', onPointerMove);
            app.canvas.addEventListener('pointerup', onPointerUp);
            app.canvas.addEventListener('pointercancel', onPointerUp);
            app.canvas.addEventListener('pointerleave', onPointerUp);

            // Clear previous caches
            neuronGraphicsRef.current.clear();
            connectionsMetaRef.current.clear();

            // Compute a nicer layout before drawing
            const laidOut = layoutNodes(
                app.renderer.width,
                app.renderer.height,
                graphData.neurons.map(n => ({ ...n }))
            );
            const idToNode = new Map<string, NeuronData>(
                laidOut.map(n => [n.id, n] as const)
            );

            // Compute fan-out per-source and per-target to reduce crossings
            const outMap = new Map<string, ConnectionData[]>();
            const inMap = new Map<string, ConnectionData[]>();
            graphData.connections.forEach(c => {
                const o = outMap.get(c.from) || [];
                o.push(c);
                outMap.set(c.from, o);
                const i = inMap.get(c.to) || [];
                i.push(c);
                inMap.set(c.to, i);
            });

            graphData.connections.forEach((connection, edgeIndex) => {
                const fromNeuron = idToNode.get(connection.from);
                const toNeuron = idToNode.get(connection.to);
                if (!fromNeuron || !toNeuron) return;

                const outs = outMap.get(connection.from) || [connection];
                const ins = inMap.get(connection.to) || [connection];
                const idxFrom = outs.indexOf(connection);
                const idxTo = ins.indexOf(connection);
                const midFrom = (outs.length - 1) / 2;
                const midTo = (ins.length - 1) / 2;

                // Weighted fan-out from source and target sides
                const fanFrom = (idxFrom - midFrom) * 14;
                const fanTo = (idxTo - midTo) * 14;
                const fanOffset = fanFrom + fanTo;

                const { graphic, ctrl } = createConnectionGraphic(
                    connection,
                    fromNeuron,
                    toNeuron,
                    fanOffset
                );
                connectionsContainer.addChild(graphic);

                if (connection.label) {
                    const midPoint = pointOnQuadratic(
                        0.5,
                        { x: fromNeuron.x, y: fromNeuron.y },
                        ctrl,
                        { x: toNeuron.x, y: toNeuron.y }
                    );
                    const label = new PIXI.Text(connection.label, {
                        fontFamily: 'Px437_IBM_Conv, monospace',
                        fontSize: 9,
                        fill: '#8b7355', // Theme yellow pus color
                        stroke: '#1a1409',
                    });
                    label.anchor.set(0.5);
                    label.position.set(midPoint.x, midPoint.y - 12);
                    connectionsContainer.addChild(label);
                }

                // Particles based on activity
                const activity = Math.max(
                    1,
                    Math.min(30, connection.stimulationCount)
                );
                const count = Math.max(2, Math.ceil(activity / 4));
                const particles: PIXI.Graphics[] = [];
                for (let i = 0; i < count; i++) {
                    const p = new PIXI.Graphics();
                    p.circle(0, 0, 2).fill({ color: 0xa83c3c, alpha: 0.8 }); // Theme red
                    p.alpha = 0.7;
                    connectionsContainer.addChild(p);
                    particles.push(p);
                    (p as any).__t = Math.random();
                }

                const id = `${connection.from}->${connection.to}#${edgeIndex}`;
                connectionsMetaRef.current.set(id, {
                    graphic,
                    particles,
                    ctrl,
                    from: { x: fromNeuron.x, y: fromNeuron.y },
                    to: { x: toNeuron.x, y: toNeuron.y },
                    speed: 0.004 + Math.min(0.02, activity / 3000),
                });
            });

            // Draw neurons
            laidOut.forEach(neuron => {
                const neuronContainer = createNeuronGraphic(neuron);
                neuronContainer.x = neuron.x;
                neuronContainer.y = neuron.y;
                neuronsContainer.addChild(neuronContainer);
                neuronGraphicsRef.current.set(neuron.id, neuronContainer);
            });

            // Animate particles along curves
            const updateParticles = () => {
                const wobble = performance.now() * 0.0015;
                connectionsMetaRef.current.forEach(meta => {
                    const { particles, from, ctrl, to, speed, graphic } =
                        meta as {
                            particles: PIXI.Graphics[];
                            from: { x: number; y: number };
                            ctrl: { x: number; y: number };
                            to: { x: number; y: number };
                            speed: number;
                            graphic: PIXI.Graphics;
                        };
                    // Vein wobble: animate control point slightly
                    const wobX =
                        Math.sin(wobble + from.x * 0.01 + to.y * 0.01) * 6;
                    const wobY =
                        Math.cos(wobble + from.y * 0.01 + to.x * 0.01) * 6;
                    const dynamicCtrl = { x: ctrl.x + wobX, y: ctrl.y + wobY };

                    // Redraw path with wobble
                    graphic.clear();
                    const color = 0x6b2737;
                    graphic.moveTo(from.x, from.y);
                    (graphic as any).quadraticCurveTo(
                        dynamicCtrl.x,
                        dynamicCtrl.y,
                        to.x,
                        to.y
                    );
                    graphic.stroke({ color, width: 2, alpha: 0.6 });

                    particles.forEach((p: PIXI.Graphics) => {
                        let t = (p as any).__t as number;
                        t += speed;
                        if (t > 1) t = 0;
                        const pos = pointOnQuadratic(t, from, dynamicCtrl, to);
                        p.position.set(pos.x, pos.y);
                        (p as any).__t = t;
                    });
                });
            };
            app.ticker.add(updateParticles);
            (app as any).__cleanupParticles = () =>
                app.ticker.remove(updateParticles);
        })();

        return () => {
            destroyed = true;
            if (handleResize)
                window.removeEventListener('resize', handleResize);
            if (appRef.current) {
                // Clean up panning event listeners
                const canvas = appRef.current.canvas;
                if (canvas && panHandlers) {
                    canvas.removeEventListener(
                        'pointerdown',
                        panHandlers.onPointerDown
                    );
                    canvas.removeEventListener(
                        'pointermove',
                        panHandlers.onPointerMove
                    );
                    canvas.removeEventListener(
                        'pointerup',
                        panHandlers.onPointerUp
                    );
                    canvas.removeEventListener(
                        'pointercancel',
                        panHandlers.onPointerUp
                    );
                    canvas.removeEventListener(
                        'pointerleave',
                        panHandlers.onPointerUp
                    );
                    canvas.style.cursor = '';
                }
                try {
                    (appRef.current as any).__cleanupParticles?.();
                } catch {}
                appRef.current.destroy(true);
                appRef.current = null;
            }
            neuronGraphicsRef.current.clear();
            connectionsMetaRef.current.clear();
        };
    }, [graphData]);

    useEffect(() => {
        if (neuronGraphicsRef.current.size > 0) {
            updateNeuronSelection(selectedNeuron);
        }
    }, [selectedNeuron]);

    // Calculate scroll indicators
    // Correct indicator logic: show when content exceeds viewport in that direction
    // We assume rootContainer at offset (viewOffset.x, viewOffset.y) where 0,0 means content origin aligned to canvas origin
    const canScrollUp = contentBounds.minY + viewOffset.y < 0;
    const canScrollDown = contentBounds.maxY + viewOffset.y > canvasSize.height;
    const canScrollLeft = contentBounds.minX + viewOffset.x < 0;
    const canScrollRight = contentBounds.maxX + viewOffset.x > canvasSize.width;

    const showScrollUp = canScrollUp;
    const showScrollDown = canScrollDown;
    const showScrollLeft = canScrollLeft;
    const showScrollRight = canScrollRight;

    if (pixiError) {
        return (
            <SimpleCanvasGraph
                neurons={neurons}
                connections={connections}
                onNeuronClick={onNeuronClick}
                className={className}
            />
        );
    }

    return (
        <div
            className={`cns-graph-container ${className}`}
            style={{ position: 'relative', width: '100%', height: '100%' }}
        >
            <div
                ref={canvasRef}
                className="cns-graph"
                style={{ width: '100%', height: '100%', minHeight: '400px' }}
            />

            {/* Scroll indicators */}
            {showScrollUp && (
                <div
                    className="scroll-indicator scroll-up"
                    style={{
                        position: 'absolute',
                        top: '10px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        pointerEvents: 'none',
                        color: '#8b7355',
                        fontSize: '20px',
                        textShadow: '0 0 4px #000',
                        opacity: 0.8,
                        zIndex: 10,
                    }}
                >
                    ▲
                </div>
            )}

            {showScrollDown && (
                <div
                    className="scroll-indicator scroll-down"
                    style={{
                        position: 'absolute',
                        bottom: '10px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        pointerEvents: 'none',
                        color: '#8b7355',
                        fontSize: '20px',
                        textShadow: '0 0 4px #000',
                        opacity: 0.8,
                        zIndex: 10,
                    }}
                >
                    ▼
                </div>
            )}

            {showScrollLeft && (
                <div
                    className="scroll-indicator scroll-left"
                    style={{
                        position: 'absolute',
                        left: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                        color: '#8b7355',
                        fontSize: '20px',
                        textShadow: '0 0 4px #000',
                        opacity: 0.8,
                        zIndex: 10,
                    }}
                >
                    ◀
                </div>
            )}

            {showScrollRight && (
                <div
                    className="scroll-indicator scroll-right"
                    style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                        color: '#8b7355',
                        fontSize: '20px',
                        textShadow: '0 0 4px #000',
                        opacity: 0.8,
                        zIndex: 10,
                    }}
                >
                    ▶
                </div>
            )}
        </div>
    );
};

export default CNSGraph;
