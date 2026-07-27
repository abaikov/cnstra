import type { TExoSchema } from '@exodra/core';
import { bindable, derive } from '@exodra/reactivity';
import type { TExoBindable } from '@exodra/reactivity';
import cytoscape, {
    Core,
    EdgeDefinition,
    ElementDefinition,
    NodeDefinition,
} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import coseBilkent from 'cytoscape-cose-bilkent';
import { EMPTY_FRONTIER, FrontierData, frontierSeverity } from './frontier';

// Native Exodra port of the cytoscape graph. Cytoscape is fully imperative, so
// this is a natural fit: the React refs become plain closure vars, `useState`
// becomes a bindable, the init `useEffect` runs in `onExoMount` (given the
// container element), incremental updates run on a subscription to the reactive
// props bindable, and cleanup runs in `onExoUnmount`. The cytoscape logic
// (styles, element diffing, frontier) is unchanged.

export type { FrontierData } from './frontier';

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

export interface CNSGraphProps {
    neurons: NeuronData[];
    connections: ConnectionData[];
    onNeuronClick: (neuron: NeuronData) => void;
    frontier?: FrontierData;
    className?: string;
}

type LayoutName = 'cose-bilkent' | 'dagre';

const buildLabel = (n: NeuronData): string => {
    const stats: string[] = [];
    if (n.stimulationCount !== undefined && n.stimulationCount > 0)
        stats.push(`⚡${n.stimulationCount}`);
    if (n.responseCount !== undefined && n.responseCount > 0)
        stats.push(`📡${n.responseCount}`);
    if (n.errorCount !== undefined && n.errorCount > 0)
        stats.push(`❌${n.errorCount}`);
    if (n.avgDuration !== undefined && n.avgDuration > 0)
        stats.push(`⏱️${Math.round(n.avgDuration)}ms`);
    return stats.length > 0 ? `${n.name}\n${stats.join('  ')}` : n.name;
};

const colorFor = (stim: number): string =>
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

const edgeId = (e: ConnectionData): string =>
    `${e.from}->${e.to}::${e.label || ''}`;

const nodeDef = (n: NeuronData): NodeDefinition => ({
    data: {
        id: n.id,
        label: buildLabel(n),
        stim: n.stimulationCount || 0,
        type: n.type,
        responseCount: n.responseCount || 0,
        errorCount: n.errorCount || 0,
        avgDuration: n.avgDuration || 0,
    },
});

const buildElements = (
    neurons: NeuronData[],
    connections: ConnectionData[]
): ElementDefinition[] => {
    const nodes: NodeDefinition[] = neurons.map(nodeDef);
    const edges: EdgeDefinition[] = connections.map(e => ({
        data: {
            id: edgeId(e),
            source: e.from,
            target: e.to,
            label: e.label || '',
            stim: e.stimulationCount,
            weight: e.weight,
        },
    }));
    return [...nodes, ...edges];
};

const getLayoutOptions = (name: LayoutName): any => {
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
        };
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
    };
};

const GRAPH_STYLE: any = [
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
    { selector: 'node[type = "input"]', style: { 'border-color': '#00c853' } },
    { selector: 'node[type = "output"]', style: { 'border-color': '#ff5252' } },
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
    {
        selector: 'node[frontier = 1]',
        style: {
            'border-color': '#00e5ff',
            'border-width': '6',
            'overlay-color': '#00e5ff',
            'overlay-opacity': '0.12',
        },
    },
    {
        selector: 'edge[frontier = 1]',
        style: {
            'line-color': '#00e5ff',
            'target-arrow-color': '#00e5ff',
            width: '6',
            opacity: 1,
        },
    },
    {
        selector: 'node[frontier = 2]',
        style: {
            'border-color': '#ffb84d',
            'border-width': '7',
            'overlay-color': '#ffb84d',
            'overlay-opacity': '0.16',
        },
    },
    {
        selector: 'edge[frontier = 2]',
        style: {
            'line-color': '#ffb84d',
            'target-arrow-color': '#ffb84d',
            width: '6',
            opacity: 1,
        },
    },
    {
        selector: 'node[frontier = 3]',
        style: {
            'border-color': '#ff3b30',
            'border-width': '9',
            'overlay-color': '#ff3b30',
            'overlay-opacity': '0.24',
        },
    },
    {
        selector: 'edge[frontier = 3]',
        style: {
            'line-color': '#ff3b30',
            'target-arrow-color': '#ff3b30',
            width: '8',
            opacity: 1,
        },
    },
];

export function cnsGraph(props: TExoBindable<CNSGraphProps>): TExoSchema {
    // ── Imperative state (was refs) ──────────────────────────────────────────
    let cy: Core | null = null;
    let frontierData: FrontierData = EMPTY_FRONTIER;
    let frontierApplied = new Set<string>();
    let hasFit = false;
    let lastLayoutName: LayoutName | null = null;
    let neuronsMap = new Map<string, NeuronData>();
    let clickHandler: (n: NeuronData) => void = () => {};
    let intervalId = 0;
    let unsubProps: () => void = () => {};
    let unsubLayout: () => void = () => {};

    const layoutName = bindable<LayoutName>('cose-bilkent');
    const initial = props.getValue();
    const className = initial.className ?? '';

    // ── Frontier application (reads closure state; safe for interval) ─────────
    const applyFrontier = (): void => {
        if (!cy) return;
        const f = frontierData;
        const now = Date.now();
        const nextIds = new Set<string>();
        for (const nid in f.neurons) {
            const el = cy.getElementById(nid);
            if (el.empty()) continue;
            el.data('frontier', frontierSeverity(now - f.neurons[nid]));
            nextIds.add(nid);
        }
        for (const eid in f.edges) {
            const el = cy.getElementById(eid);
            if (el.empty()) continue;
            el.data('frontier', frontierSeverity(now - f.edges[eid]));
            nextIds.add(eid);
        }
        for (const id of frontierApplied) {
            if (!nextIds.has(id)) {
                const el = cy.getElementById(id);
                if (!el.empty()) el.data('frontier', 0);
            }
        }
        frontierApplied = nextIds;
    };

    // ── Incremental update: diff data in place; re-layout only on a topology
    //    change or a layout switch. ───────────────────────────────────────────
    const incrementalUpdate = (
        neurons: NeuronData[],
        connections: ConnectionData[]
    ): void => {
        if (!cy) return;

        const desiredNodeIds = new Set(neurons.map(n => n.id));
        const desiredNodesMap = new Map(neurons.map(n => [n.id, n]));
        const desiredEdgeIds = new Set(connections.map(edgeId));
        const desiredEdgesMap = new Map(connections.map(e => [edgeId(e), e]));

        const currentNodeIds = new Set<string>();
        cy.nodes().forEach(n => {
            currentNodeIds.add(n.id());
        });
        const currentEdgeIds = new Set<string>();
        cy.edges().forEach(e => {
            currentEdgeIds.add(e.id());
        });

        const nodesToRemove: string[] = [];
        currentNodeIds.forEach(id => {
            if (!desiredNodeIds.has(id)) nodesToRemove.push(id);
        });
        const nodesToAdd: ElementDefinition[] = [];
        desiredNodeIds.forEach(id => {
            if (!currentNodeIds.has(id))
                nodesToAdd.push(nodeDef(desiredNodesMap.get(id)!));
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

        if (nodesToRemove.length > 0)
            cy.remove(nodesToRemove.map(id => cy!.getElementById(id)) as any);
        if (edgesToRemove.length > 0)
            cy.remove(edgesToRemove.map(id => cy!.getElementById(id)) as any);
        if (nodesToAdd.length > 0) cy.add(nodesToAdd);
        if (edgesToAdd.length > 0) cy.add(edgesToAdd);

        desiredNodeIds.forEach(id => {
            if (currentNodeIds.has(id)) {
                const desired = desiredNodesMap.get(id)!;
                const node = cy!.getElementById(id);
                node.data('label', buildLabel(desired));
                node.data('stim', desired.stimulationCount || 0);
                node.data('type', desired.type);
                node.data('responseCount', desired.responseCount || 0);
                node.data('errorCount', desired.errorCount || 0);
                node.data('avgDuration', desired.avgDuration || 0);
                node.data('color', colorFor(desired.stimulationCount || 0));
            }
        });

        desiredEdgeIds.forEach(id => {
            if (currentEdgeIds.has(id)) {
                const desired = desiredEdgesMap.get(id)!;
                const edge = cy!.getElementById(id);
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

        const name = layoutName.getValue();
        if (topologyChanged || lastLayoutName !== name) {
            cy.layout(getLayoutOptions(name)).run();
            if (!hasFit || lastLayoutName !== name) {
                cy.fit(undefined, 30);
                hasFit = true;
            }
            lastLayoutName = name;
        }
    };

    // ── Lifecycle: init cytoscape into the container element on mount ─────────
    const initCytoscape = (container: HTMLElement): void => {
        const p = props.getValue();
        clickHandler = p.onNeuronClick;
        neuronsMap = new Map(p.neurons.map(n => [n.id, n]));
        frontierData = p.frontier ?? EMPTY_FRONTIER;

        cy = cytoscape({
            container,
            elements: buildElements(p.neurons, p.connections),
            style: GRAPH_STYLE,
            layout: getLayoutOptions(layoutName.getValue()),
            wheelSensitivity: 0.2,
            pixelRatio: 1,
        });
        lastLayoutName = layoutName.getValue();

        cy.nodes().forEach(n => {
            n.data('color', colorFor((n.data('stim') as number) || 0));
        });

        cy.on('tap', 'node', evt => {
            const data = neuronsMap.get(evt.target.id());
            if (data) clickHandler(data);
        });
        const hl = (add: boolean) => (evt: any) => {
            const n = evt.target as any;
            const neighborhood =
                (n.closedNeighborhood && n.closedNeighborhood()) ||
                n.neighborhood();
            if (add) neighborhood.addClass('highlighted');
            else neighborhood.removeClass('highlighted');
        };
        cy.on('mouseover', 'node', hl(true));
        cy.on('mouseout', 'node', hl(false));

        try {
            (window as any).__cnsCy = cy;
        } catch {}

        applyFrontier();
        intervalId = window.setInterval(applyFrontier, 600);

        // React to new props (graph data / frontier / click handler).
        unsubProps = props.subscribe(() => {
            const next = props.getValue();
            clickHandler = next.onNeuronClick;
            neuronsMap = new Map(next.neurons.map(n => [n.id, n]));
            frontierData = next.frontier ?? EMPTY_FRONTIER;
            incrementalUpdate(next.neurons, next.connections);
            applyFrontier();
        });
        // React to a layout switch.
        unsubLayout = layoutName.subscribe(() => {
            const cur = props.getValue();
            incrementalUpdate(cur.neurons, cur.connections);
        });
    };

    const teardown = (): void => {
        window.clearInterval(intervalId);
        unsubProps();
        unsubLayout();
        if (cy) {
            cy.destroy();
            cy = null;
        }
        try {
            (window as any).__cnsCy = null;
        } catch {}
    };

    // ── Controls ─────────────────────────────────────────────────────────────
    const handleFit = () => cy?.fit(undefined, 30);
    const handleZoom = (delta: number) => {
        if (!cy) return;
        const z = cy.zoom();
        const target = Math.max(0.2, Math.min(3, z + delta));
        cy.zoom({
            level: target,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
    };
    const relayoutBorder = (name: LayoutName) =>
        derive(layoutName, l =>
            l === name ? 'border-color:var(--infection-green)' : ''
        );

    const legendItem = (bg: string, label: string): TExoSchema => (
        <div static={{ class: 'cns-graph-legend-item' }}>
            <div static={{ class: 'cns-graph-legend-color', style: `background:${bg}` }} />
            <span>{label}</span>
        </div>
    );

    return (
        <div
            static={{
                class: `cns-graph-container ${className}`,
                style: 'position:relative;width:100%;height:100%',
            }}
        >
            <div
                static={{
                    class: 'cns-graph',
                    style: 'width:100%;height:100%;min-height:400px',
                    onExoMount: (node: { element: unknown }) =>
                        initCytoscape(node.element as HTMLElement),
                    onExoUnmount: teardown,
                }}
            />

            <div static={{ class: 'cns-graph-legend' }}>
                <h3>Legend</h3>
                {legendItem('#6b4940', 'Inactive')}
                {legendItem('#8b5a52', 'Low activity')}
                {legendItem('#b86b63', 'Medium')}
                {legendItem('#d4a574', 'High')}
                {legendItem('#6fb84a', 'Very high')}
                {legendItem('#6b4d3a', 'Edge thickness = response volume')}
            </div>

            <div static={{ class: 'cns-graph-controls' }}>
                <button
                    static={{ class: 'cns-graph-control-btn' }}
                    handlers={{ onClick: () => handleZoom(0.2) }}
                >
                    ＋ Zoom
                </button>
                <button
                    static={{ class: 'cns-graph-control-btn' }}
                    handlers={{ onClick: () => handleZoom(-0.2) }}
                >
                    － Zoom
                </button>
                <button
                    static={{ class: 'cns-graph-control-btn' }}
                    handlers={{ onClick: handleFit }}
                >
                    Fit
                </button>
                <button
                    static={{ class: 'cns-graph-control-btn' }}
                    bindable={{ style: relayoutBorder('cose-bilkent') }}
                    handlers={{ onClick: () => layoutName.setValue('cose-bilkent') }}
                >
                    COSE-Bilkent
                </button>
                <button
                    static={{ class: 'cns-graph-control-btn' }}
                    bindable={{ style: relayoutBorder('dagre') }}
                    handlers={{ onClick: () => layoutName.setValue('dagre') }}
                >
                    Dagre
                </button>
            </div>
        </div>
    );
}

export default cnsGraph;
