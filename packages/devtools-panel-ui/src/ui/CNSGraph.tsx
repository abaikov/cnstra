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

    const elements = useMemo<ElementDefinition[]>(() => {
        const nodes: NodeDefinition[] = neurons.map(n => ({
            data: {
                id: n.id,
                label: n.name,
                stim: n.stimulationCount,
                type: n.type,
            },
        }));
        const edges: EdgeDefinition[] = connections.map((e, i) => ({
            data: {
                id: `${e.from}->${e.to}#${i}`,
                source: e.from,
                target: e.to,
                label: e.label || '',
                stim: e.stimulationCount,
                weight: e.weight,
            },
        }));
        return [...nodes, ...edges];
    }, [neurons, connections]);

    useEffect(() => {
        if (!containerRef.current) return;

        const cy = cytoscape({
            container: containerRef.current,
            elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': 'data(color)',
                        label: 'data(label)',
                        'font-family': 'Px437_IBM_Conv, monospace',
                        'font-size': 12,
                        'font-weight': 'bold',
                        color: '#f0ece4',
                        'text-outline-color': '#1a1409',
                        'text-outline-width': 2,
                        'text-valign': 'center',
                        'text-halign': 'center',
                        width: 'mapData(stim, 0, 50, 50, 120)',
                        height: 34,
                        'border-width': 2,
                        'border-color': '#2e2218',
                        shape: 'round-rectangle',
                        padding: 8,
                        'overlay-color': '#a83c3c',
                        'overlay-opacity': 0,
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
                        width: 'mapData(stim, 0, 50, 1.5, 6)',
                        opacity: 0.85,
                        'target-arrow-shape': 'triangle',
                        'target-arrow-color': '#6b4d3a',
                        'arrow-scale': 1,
                        label: 'data(label)',
                        'font-family': 'Px437_IBM_Conv, monospace',
                        'font-size': 9,
                        color: '#cbb79f',
                        'text-background-color': '#0a0908',
                        'text-background-opacity': 0.9,
                        'text-background-padding': 2,
                        'text-rotation': 'autorotate',
                        'text-margin-y': -6,
                    },
                },
                {
                    selector: 'node:selected',
                    style: {
                        'border-width': 3,
                        'border-color': '#a83c3c',
                        'overlay-opacity': 0.06,
                    },
                },
                {
                    selector: 'edge:selected',
                    style: {
                        'line-color': '#a83c3c',
                        'target-arrow-color': '#a83c3c',
                        width: 6,
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
            ],
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

        // Click handling
        cy.on('tap', 'node', evt => {
            const n = evt.target;
            const data = neurons.find(x => x.id === n.id());
            if (data) onNeuronClick(data);
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
        return () => {
            cy.destroy();
            cyRef.current = null;
        };
    }, [elements, onNeuronClick, neurons, layoutName]);

    // Update elements on prop change (without recreating cy instance if possible)
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.elements().remove();
        cy.add(elements);
        // Update node colors after add
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
        // Re-run layout for new data
        const layout = cy.layout(getLayoutOptions(layoutName));
        layout.run();
        cy.fit(undefined, 30);
    }, [elements, layoutName]);

    const getLayoutOptions = (name: 'cose-bilkent' | 'dagre'): any => {
        if (name === 'dagre') {
            return {
                name: 'dagre',
                rankDir: 'LR',
                nodeDimensionsIncludeLabels: true,
                animate: true,
                animationDuration: 400,
                padding: 30,
            } as any;
        }
        return {
            name: 'cose-bilkent',
            quality: 'default',
            randomize: true,
            nodeDimensionsIncludeLabels: true,
            animate: 'end',
            animationDuration: 500,
            idealEdgeLength: 120,
            edgeElasticity: 0.2,
            nodeRepulsion: 8000,
            gravity: 0.25,
            gravityRange: 2.4,
            gravityCompound: 1.0,
            padding: 30,
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
