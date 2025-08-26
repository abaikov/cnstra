import ELK from 'elkjs';
import { ICNSGraphLayout } from './interfaces/ICNSGraphLayout';

export interface TCNSGraphNode {
    id: string;
    label?: string;
    group?: string;
    color?: string;
    layer?: number;
    x?: number;
    y?: number;
    width: number;
    height: number;
}

export interface TCNSGraphEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
    type?: string;
}

export interface TCNSLayoutResult {
    nodes: TCNSGraphNode[];
    edges: TCNSGraphEdge[];
}

export class GraphLayout implements ICNSGraphLayout {
    private elk: any;

    constructor() {
        this.elk = new ELK();
    }

    async computeLayout(
        nodes: TCNSGraphNode[],
        edges: TCNSGraphEdge[]
    ): Promise<TCNSLayoutResult> {
        const elkGraph = {
            id: 'root',
            layoutOptions: {
                'elk.algorithm': 'layered',
                'elk.direction': 'RIGHT',
                'elk.spacing.nodeNode': '50',
                'elk.layered.spacing.nodeNodeBetweenLayers': '100',
                'elk.edgeRouting': 'ORTHOGONAL',
            },
            children: nodes.map(node => ({
                id: node.id,
                width: node.width,
                height: node.height,
                labels: node.label ? [{ text: node.label }] : [],
            })),
            edges: edges.map(edge => ({
                id: edge.id,
                sources: [edge.source],
                targets: [edge.target],
                labels: edge.label ? [{ text: edge.label }] : [],
            })),
        };

        try {
            const result = await this.elk.layout(elkGraph);

            // Update node positions
            const positionedNodes = nodes.map(node => {
                const elkNode = result.children?.find(
                    (n: any) => n.id === node.id
                );
                return {
                    ...node,
                    x: elkNode?.x || 0,
                    y: elkNode?.y || 0,
                };
            });

            return {
                nodes: positionedNodes,
                edges: edges,
            };
        } catch (error) {
            console.error('ELK layout failed:', error);
            // Fallback to simple grid layout
            return this.fallbackLayout(nodes, edges);
        }
    }

    private fallbackLayout(
        nodes: TCNSGraphNode[],
        edges: TCNSGraphEdge[]
    ): TCNSLayoutResult {
        const cols = Math.ceil(Math.sqrt(nodes.length));
        const nodeWidth = 120;
        const nodeHeight = 80;
        const spacing = 50;

        const positionedNodes = nodes.map((node, index) => ({
            ...node,
            x: (index % cols) * (nodeWidth + spacing),
            y: Math.floor(index / cols) * (nodeHeight + spacing),
            width: nodeWidth,
            height: nodeHeight,
        }));

        return {
            nodes: positionedNodes,
            edges: edges,
        };
    }
}
