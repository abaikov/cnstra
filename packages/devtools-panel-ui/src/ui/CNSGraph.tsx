import React, { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, {
    Core,
    EdgeDefinition,
    ElementDefinition,
    NodeDefinition,
} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import coseBilkent from 'cytoscape-cose-bilkent';

cytoscape.use(dagre);
cytoscape.use(coseBilkent);

interface NeuronData {
    id: string;
    name: string;
    x: number;
    y: number;
    stimulationCount: number;
    stimulations: StimulationData[];
    type: 'input' | 'processing' | 'output';
    responseCount?: number;
    errorCount?: number;
    avgDuration?: number;
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
    const containerRef = useRef<HTMLDivElement | null>(null);
    const cyRef = useRef<Core | null>(null);
    const [layoutName, setLayoutName] = useState<'cose-bilkent' | 'dagre'>(
        'cose-bilkent'
    );
    const clickHandlerRef = useRef<(neuron: NeuronData) => void>(() => {});
    const hasFitRef = useRef<boolean>(false);
    const lastLayoutNameRef = useRef<'cose-bilkent' | 'dagre' | null>(null);
    const neuronsMapRef = useRef<Map<string, NeuronData>>(new Map());

    const elements = useMemo<ElementDefinition[]>(() => {
        const nodes: NodeDefinition[] = neurons.map(n => {
            // Create multi-line label with stats
            const stats = [];
            if (n.stimulationCount !== undefined && n.stimulationCount > 0) {
                stats.push(`⚡${n.stimulationCount}`);
            }
            if (n.responseCount !== undefined && n.responseCount > 0) {
                stats.push(`📡${n.responseCount}`);
            }
            if (n.errorCount !== undefined && n.errorCount > 0) {
                stats.push(`❌${n.errorCount}`);
            }
            if (n.avgDuration !== undefined && n.avgDuration > 0) {
                stats.push(`⏱️${Math.round(n.avgDuration)}ms`);
            }

            const label =
                stats.length > 0 ? `${n.name}\n${stats.join('  ')}` : n.name;

            return {
                data: {
                    id: n.id,
                    label: label,
                    stim: n.stimulationCount || 0,
                    type: n.type,
                    responseCount: n.responseCount || 0,
                    errorCount: n.errorCount || 0,
                    avgDuration: n.avgDuration || 0,
                },
            };
        });
        const edges: EdgeDefinition[] = connections.map(e => ({
            data: {
                id: `${e.from}->${e.to}::${e.label || ''}`,
                source: e.from,
                target: e.to,
                label: e.label || '',
                stim: e.stimulationCount,
                weight: e.weight,
            },
        }));
        return [...nodes, ...edges];
    }, [neurons, connections]);

    // keep the latest click handler without retriggering cy init
    useEffect(() => {
        clickHandlerRef.current = onNeuronClick;
    }, [onNeuronClick]);

    // keep latest neurons map for click lookup
    useEffect(() => {
        const map = new Map<string, NeuronData>();
        for (const n of neurons) map.set(n.id, n);
        neuronsMapRef.current = map;
    }, [neurons]);

    // Initialize Cytoscape once
    useEffect(() => {
        if (!containerRef.current) return;

        const cy = cytoscape({
            container: containerRef.current,
            elements,
            // Cast to any to avoid over-constrained cytoscape TS style types
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': 'data(color)',
                        label: 'data(label)',
                        'font-family': 'Px437_IBM_Conv, monospace',
                        'font-size': '13',
                        'font-weight': 'bold',
                        color: '#f0ece4',
                        'text-outline-color': '#1a1409',
                        'text-outline-width': '3',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        width: 'mapData(stim, 0, 50, 180, 280)',
                        height: 'mapData(stim, 0, 50, 80, 120)',
                        'border-width': '3',
                        'border-color': '#2e2218',
                        shape: 'round-rectangle',
                        padding: '16',
                        'overlay-color': '#a83c3c',
                        'overlay-opacity': '0',
                        'text-wrap': 'wrap',
                        'text-max-width': '240',
                        'line-height': '1.4',
                    },
                },
                {
                    selector: 'node[type = "input"]',
                    style: { 'border-color': '#00c853' },
                },
                {
                    selector: 'node[type = "output"]',
                    style: { 'border-color': '#ff5252' },
                },
                {
                    selector: 'edge',
                    style: {
                        'curve-style': 'bezier',
                        'line-color': '#6b4d3a',
                        width: 'mapData(stim, 0, 50, 2, 8)',
                        opacity: 0.9,
                        'target-arrow-shape': 'triangle',
                        'target-arrow-color': '#6b4d3a',
                        'arrow-scale': '1.5',
                        'arrow-fill': 'filled',
                        label: 'data(label)',
                        'font-family': 'Px437_IBM_Conv, monospace',
                        'font-size': '11',
                        'font-weight': 'bold',
                        color: '#f0ece4',
                        'text-outline-color': '#1a1409',
                        'text-outline-width': '2',
                        'text-background-color': '#0a0908',
                        'text-background-opacity': '0.95',
                        'text-background-padding': '4',
                        'text-rotation': 'autorotate',
                        'text-margin-y': '-8',
                    },
                },
                {
                    selector: 'node:selected',
                    style: {
                        'border-width': '3',
                        'border-color': '#a83c3c',
                        'overlay-opacity': '0.06',
                    },
                },
                {
                    selector: 'edge:selected',
                    style: {
                        'line-color': '#a83c3c',
                        'target-arrow-color': '#a83c3c',
                        width: '6',
                    },
                },
                {
                    selector: '.highlighted',
                    style: {
                        'border-color': '#a83c3c',
                        'line-color': '#a83c3c',
                        'target-arrow-color': '#a83c3c',
                        opacity: 1,
                    },
                },
            ] as any,
            layout: getLayoutOptions(layoutName),
            wheelSensitivity: 0.2,
            pixelRatio: 1,
        });

        // Map activity to colors
        cy.nodes().forEach(n => {
            const stim = (n.data('stim') as number) || 0;
            const color =
                stim === 0
                    ? '#6b4940'
                    : stim < 5
                    ? '#8b5a52'
                    : stim < 15
                    ? '#b86b63'
                    : stim < 30
                    ? '#d4a574'
                    : stim < 50
                    ? '#8ba85c'
                    : '#6fb84a';
            n.data('color', color);
        });

        // Click handling - use refs to avoid dependency resets
        cy.on('tap', 'node', evt => {
            const n = evt.target;
            const data = neuronsMapRef.current.get(n.id());
            if (data) clickHandlerRef.current(data);
        });

        // Hover highlight neighborhood
        const enter = (evt: any) => {
            const n = evt.target as any;
            const neighborhood =
                (n.closedNeighborhood && n.closedNeighborhood()) ||
                n.neighborhood();
            neighborhood.addClass('highlighted');
        };
        const leave = (evt: any) => {
            const n = evt.target as any;
            const neighborhood =
                (n.closedNeighborhood && n.closedNeighborhood()) ||
                n.neighborhood();
            neighborhood.removeClass('highlighted');
        };
        cy.on('mouseover', 'node', enter);
        cy.on('mouseout', 'node', leave);

        cyRef.current = cy;
        // Expose Cytoscape instance for E2E tests
        try {
            if (typeof window !== 'undefined') {
                (window as any).__cnsCy = cy;
            }
        } catch {}
        return () => {
            cy.destroy();
            cyRef.current = null;
            try {
                if (typeof window !== 'undefined') {
                    (window as any).__cnsCy = null;
                }
            } catch {}
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Incremental updates: update data in-place; re-layout only when topology changes or layout switches
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        // Desired nodes/edges
        const desiredNodeIds = new Set(neurons.map(n => n.id));
        const desiredNodesMap = new Map(neurons.map(n => [n.id, n]));
        const edgeId = (e: ConnectionData) =>
            `${e.from}->${e.to}::${e.label || ''}`;
        const desiredEdgeIds = new Set(connections.map(edgeId));
        const desiredEdgesMap = new Map(connections.map(e => [edgeId(e), e]));

        // Current nodes/edges
        const currentNodes = cy.nodes();
        const currentNodeIds = new Set<string>();
        currentNodes.forEach(n => {
            currentNodeIds.add(n.id());
        });
        const currentEdges = cy.edges();
        const currentEdgeIds = new Set<string>();
        currentEdges.forEach(e => {
            currentEdgeIds.add(e.id());
        });

        // Compute diffs
        const nodesToRemove: string[] = [];
        currentNodeIds.forEach(id => {
            if (!desiredNodeIds.has(id)) nodesToRemove.push(id);
        });
        const nodesToAdd: ElementDefinition[] = [];
        desiredNodeIds.forEach(id => {
            if (!currentNodeIds.has(id)) {
                const n = desiredNodesMap.get(id)!;
                const stats = [];
                if (
                    n.stimulationCount !== undefined &&
                    n.stimulationCount > 0
                ) {
                    stats.push(`⚡${n.stimulationCount}`);
                }
                if (n.responseCount !== undefined && n.responseCount > 0) {
                    stats.push(`📡${n.responseCount}`);
                }
                if (n.errorCount !== undefined && n.errorCount > 0) {
                    stats.push(`❌${n.errorCount}`);
                }
                if (n.avgDuration !== undefined && n.avgDuration > 0) {
                    stats.push(`⏱️${Math.round(n.avgDuration)}ms`);
                }

                const label =
                    stats.length > 0
                        ? `${n.name}\n${stats.join('  ')}`
                        : n.name;

                nodesToAdd.push({
                    data: {
                        id: n.id,
                        label: label,
                        stim: n.stimulationCount || 0,
                        type: n.type,
                        responseCount: n.responseCount || 0,
                        errorCount: n.errorCount || 0,
                        avgDuration: n.avgDuration || 0,
                    },
                });
            }
        });

        const edgesToRemove: string[] = [];
        currentEdgeIds.forEach(id => {
            if (!desiredEdgeIds.has(id)) edgesToRemove.push(id);
        });
        const edgesToAdd: ElementDefinition[] = [];
        desiredEdgeIds.forEach(id => {
            if (!currentEdgeIds.has(id)) {
                const e = desiredEdgesMap.get(id)!;
                edgesToAdd.push({
                    data: {
                        id,
                        source: e.from,
                        target: e.to,
                        label: e.label || '',
                        stim: e.stimulationCount,
                        weight: e.weight,
                    },
                });
            }
        });

        // Apply removals
        if (nodesToRemove.length > 0) {
            cy.remove(nodesToRemove.map(id => cy.getElementById(id)) as any);
        }
        if (edgesToRemove.length > 0) {
            cy.remove(edgesToRemove.map(id => cy.getElementById(id)) as any);
        }

        // Apply additions
        if (nodesToAdd.length > 0) cy.add(nodesToAdd);
        if (edgesToAdd.length > 0) cy.add(edgesToAdd);

        // Update existing nodes' data and color
        desiredNodeIds.forEach(id => {
            if (currentNodeIds.has(id)) {
                const desired = desiredNodesMap.get(id)!;
                const node = cy.getElementById(id);

                const stats = [];
                if (
                    desired.stimulationCount !== undefined &&
                    desired.stimulationCount > 0
                ) {
                    stats.push(`⚡${desired.stimulationCount}`);
                }
                if (
                    desired.responseCount !== undefined &&
                    desired.responseCount > 0
                ) {
                    stats.push(`📡${desired.responseCount}`);
                }
                if (
                    desired.errorCount !== undefined &&
                    desired.errorCount > 0
                ) {
                    stats.push(`❌${desired.errorCount}`);
                }
                if (
                    desired.avgDuration !== undefined &&
                    desired.avgDuration > 0
                ) {
                    stats.push(`⏱️${Math.round(desired.avgDuration)}ms`);
                }

                const label =
                    stats.length > 0
                        ? `${desired.name}\n${stats.join('  ')}`
                        : desired.name;

                node.data('label', label);
                node.data('stim', desired.stimulationCount || 0);
                node.data('type', desired.type);
                node.data('responseCount', desired.responseCount || 0);
                node.data('errorCount', desired.errorCount || 0);
                node.data('avgDuration', desired.avgDuration || 0);
                const stim = desired.stimulationCount || 0;
                const color =
                    stim === 0
                        ? '#6b4940'
                        : stim < 5
                        ? '#8b5a52'
                        : stim < 15
                        ? '#b86b63'
                        : stim < 30
                        ? '#d4a574'
                        : stim < 50
                        ? '#8ba85c'
                        : '#6fb84a';
                node.data('color', color);
            }
        });

        // Update existing edges' data
        desiredEdgeIds.forEach(id => {
            if (currentEdgeIds.has(id)) {
                const desired = desiredEdgesMap.get(id)!;
                const edge = cy.getElementById(id);
                edge.data('stim', desired.stimulationCount);
                edge.data('label', desired.label || '');
                edge.data('weight', desired.weight);
            }
        });

        const topologyChanged =
            nodesToAdd.length > 0 ||
            nodesToRemove.length > 0 ||
            edgesToAdd.length > 0 ||
            edgesToRemove.length > 0;

        // Re-run layout only if topology changed or layout type switched
        if (topologyChanged || lastLayoutNameRef.current !== layoutName) {
            const layout = cy.layout(getLayoutOptions(layoutName));
            layout.run();
            if (
                !hasFitRef.current ||
                lastLayoutNameRef.current !== layoutName
            ) {
                cy.fit(undefined, 30);
                hasFitRef.current = true;
            }
            lastLayoutNameRef.current = layoutName;
        }
    }, [neurons, connections, layoutName]);

    const getLayoutOptions = (name: 'cose-bilkent' | 'dagre'): any => {
        if (name === 'dagre') {
            return {
                name: 'dagre',
                rankDir: 'LR',
                nodeDimensionsIncludeLabels: true,
                animate: true,
                animationDuration: 400,
                padding: 50,
                nodeSep: 100,
                rankSep: 150,
            } as any;
        }
        return {
            name: 'cose-bilkent',
            quality: 'default',
            randomize: true,
            nodeDimensionsIncludeLabels: true,
            animate: 'end',
            animationDuration: 500,
            idealEdgeLength: 180,
            edgeElasticity: 0.15,
            nodeRepulsion: 12000,
            gravity: 0.2,
            gravityRange: 3.0,
            gravityCompound: 1.0,
            padding: 50,
        } as any;
    };

    const handleFit = () => cyRef.current?.fit(undefined, 30);
    const handleZoom = (delta: number) => {
        const cy = cyRef.current;
        if (!cy) return;
        const z = cy.zoom();
        const target = Math.max(0.2, Math.min(3, z + delta));
        cy.zoom({
            level: target,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
    };
    const handleRelayout = (name: 'cose-bilkent' | 'dagre') => {
        setLayoutName(name);
    };

    return (
        <div
            className={`cns-graph-container ${className}`}
            style={{ position: 'relative', width: '100%', height: '100%' }}
        >
            <div
                ref={containerRef}
                className="cns-graph"
                style={{ width: '100%', height: '100%', minHeight: '400px' }}
            />
            {/* Legend */}
            <div className="cns-graph-legend">
                <h3>Legend</h3>
                <div className="cns-graph-legend-item">
                    <div
                        className="cns-graph-legend-color"
                        style={{ background: '#6b4940' }}
                    />
                    <span>Inactive</span>
                </div>
                <div className="cns-graph-legend-item">
                    <div
                        className="cns-graph-legend-color"
                        style={{ background: '#8b5a52' }}
                    />
                    <span>Low activity</span>
                </div>
                <div className="cns-graph-legend-item">
                    <div
                        className="cns-graph-legend-color"
                        style={{ background: '#b86b63' }}
                    />
                    <span>Medium</span>
                </div>
                <div className="cns-graph-legend-item">
                    <div
                        className="cns-graph-legend-color"
                        style={{ background: '#d4a574' }}
                    />
                    <span>High</span>
                </div>
                <div className="cns-graph-legend-item">
                    <div
                        className="cns-graph-legend-color"
                        style={{ background: '#6fb84a' }}
                    />
                    <span>Very high</span>
                </div>
                <div className="cns-graph-legend-item">
                    <div
                        className="cns-graph-legend-color"
                        style={{ background: '#6b4d3a' }}
                    />
                    <span>Edge thickness = response volume</span>
                </div>
            </div>

            {/* Controls */}
            <div className="cns-graph-controls">
                <button
                    className="cns-graph-control-btn"
                    onClick={() => handleZoom(0.2)}
                >
                    ＋ Zoom
                </button>
                <button
                    className="cns-graph-control-btn"
                    onClick={() => handleZoom(-0.2)}
                >
                    － Zoom
                </button>
                <button className="cns-graph-control-btn" onClick={handleFit}>
                    Fit
                </button>
                <button
                    className="cns-graph-control-btn"
                    onClick={() => handleRelayout('cose-bilkent')}
                    style={{
                        borderColor:
                            layoutName === 'cose-bilkent'
                                ? 'var(--infection-green)'
                                : undefined,
                    }}
                >
                    COSE-Bilkent
                </button>
                <button
                    className="cns-graph-control-btn"
                    onClick={() => handleRelayout('dagre')}
                    style={{
                        borderColor:
                            layoutName === 'dagre'
                                ? 'var(--infection-green)'
                                : undefined,
                    }}
                >
                    Dagre
                </button>
            </div>
        </div>
    );
};

export default CNSGraph;
