import * as PIXI from 'pixi.js';
import {
    GraphLayout,
    TCNSGraphNode,
    TCNSGraphEdge,
    TCNSLayoutResult,
} from './layout';
import { ICNSGraphRenderer } from './interfaces/ICNSGraphRenderer';
import { TCNSNodeStyle, TCNSEdgeStyle, CANVAS_BG } from '../style/TCNSTheme';

export class GraphRenderer implements ICNSGraphRenderer {
    private app: PIXI.Application;
    private layout: GraphLayout;
    private container: PIXI.Container;
    private nodes: Map<string, PIXI.Container> = new Map();
    private edges: Map<string, PIXI.Graphics> = new Map();
    private particles: PIXI.Container;

    constructor(app: PIXI.Application, layout: GraphLayout) {
        this.app = app;
        this.layout = layout;
        this.container = new PIXI.Container();
        this.particles = new PIXI.Container();

        this.container.addChild(this.particles);
        this.app.stage.addChild(this.container);

        this.setupInteraction();
    }

    private setupInteraction() {
        // Pan and zoom functionality
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let lastPosition = { x: 0, y: 0 };

        this.app.stage.eventMode = 'static';
        this.app.stage.on('pointerdown', event => {
            isDragging = true;
            dragStart = event.data.global;
            lastPosition = { x: this.container.x, y: this.container.y };
        });

        this.app.stage.on('pointermove', event => {
            if (isDragging) {
                const delta = {
                    x: event.data.global.x - dragStart.x,
                    y: event.data.global.y - dragStart.y,
                };
                this.container.x = lastPosition.x + delta.x;
                this.container.y = lastPosition.y + delta.y;
            }
        });

        this.app.stage.on('pointerup', () => {
            isDragging = false;
        });

        // Zoom with mouse wheel
        this.app.stage.on('wheel', event => {
            const zoom = event.data.deltaY > 0 ? 0.9 : 1.1;
            const newScale = this.container.scale.x * zoom;

            if (newScale > 0.1 && newScale < 5) {
                this.container.scale.set(newScale);
            }
        });
    }

    async renderGraph(nodes: TCNSGraphNode[], edges: TCNSGraphEdge[]) {
        // Clear existing graph
        this.clearGraph();

        // Compute layout
        const layoutResult = await this.layout.computeLayout(nodes, edges);

        // Render nodes
        layoutResult.nodes.forEach(node => {
            this.renderNode(node);
        });

        // Render edges
        layoutResult.edges.forEach(edge => {
            this.renderEdge(edge, layoutResult.nodes);
        });
    }

    private renderNode(node: TCNSGraphNode) {
        if (!node.x || !node.y) return;

        const nodeContainer = new PIXI.Container();

        // Create node with neon style
        const background = new PIXI.Graphics();
        const style = TCNSNodeStyle({ group: node.group });

        // Enable neon blend mode
        background.blendMode = 'add';

        // Main node
        background.beginFill(Number(style.fill.replace('#', '0x')), 1.0);
        background.lineStyle(
            style.strokeWidth,
            Number(style.stroke.replace('#', '0x')),
            1.0
        );
        background.drawCircle(0, 0, style.radius);
        background.endFill();

        // Glow effect
        background.lineStyle(1, Number(style.glow.replace('#', '0x')), 0.35);
        background.drawCircle(0, 0, style.radius + 4);

        nodeContainer.addChild(background);

        // Add label
        if (node.label) {
            const text = new PIXI.Text(node.label, {
                fontSize: 12,
                fill: 0xffffff,
                align: 'center',
            });
            text.anchor.set(0.5);
            text.x = 0;
            text.y = 0;
            nodeContainer.addChild(text);
        }

        nodeContainer.x = node.x;
        nodeContainer.y = node.y;

        this.container.addChild(nodeContainer);
        this.nodes.set(node.id, nodeContainer);
    }

    private renderEdge(edge: TCNSGraphEdge, nodes: TCNSGraphNode[]) {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);

        if (
            !sourceNode ||
            !targetNode ||
            !sourceNode.x ||
            !sourceNode.y ||
            !targetNode.x ||
            !targetNode.y
        ) {
            return;
        }

        const graphics = new PIXI.Graphics();
        const style = TCNSEdgeStyle({ group: edge.type || sourceNode.group });

        // Enable neon blend mode
        graphics.blendMode = 'add';

        // Main edge
        graphics.lineStyle(
            style.width,
            Number(style.color.replace('#', '0x')),
            style.alpha
        );
        graphics.moveTo(
            sourceNode.x + sourceNode.width / 2,
            sourceNode.y + sourceNode.height / 2
        );
        graphics.lineTo(
            targetNode.x + targetNode.width / 2,
            targetNode.y + targetNode.height / 2
        );

        // Glow effect - duplicate with thicker, more transparent line
        graphics.lineStyle(
            style.width + 4,
            Number(style.glow.replace('#', '0x')),
            0.15
        );
        graphics.moveTo(
            sourceNode.x + sourceNode.width / 2,
            sourceNode.y + sourceNode.height / 2
        );
        graphics.lineTo(
            targetNode.x + targetNode.width / 2,
            targetNode.y + targetNode.height / 2
        );

        this.container.addChild(graphics);
        this.edges.set(edge.id, graphics);
    }

    private parseColor(color: string): number {
        if (color.startsWith('#')) {
            return parseInt(color.slice(1), 16);
        }
        return 0x7fffd4; // Default color
    }

    private clearGraph() {
        this.nodes.forEach(node => node.destroy());
        this.edges.forEach(edge => edge.destroy());
        this.nodes.clear();
        this.edges.clear();
    }

    // Method to animate signal along an edge
    animateSignal(edgeId: string, duration: number = 1000) {
        const edge = this.edges.get(edgeId);
        if (!edge) return;

        const particle = new PIXI.Graphics();
        particle.beginFill(0xffff00);
        particle.drawCircle(0, 0, 3);
        particle.endFill();

        this.particles.addChild(particle);

        // Simple animation - move along the edge
        const startX = edge.x;
        const startY = edge.y;

        // TODO: Implement proper path following animation
        particle.x = startX;
        particle.y = startY;

        // Remove particle after animation
        setTimeout(() => {
            if (particle.parent) {
                particle.parent.removeChild(particle);
            }
        }, duration);
    }

    // Get edge by ID for particle system
    getEdge(edgeId: string): PIXI.Graphics | undefined {
        return this.edges.get(edgeId);
    }

    // Get PIXI app for particle system
    getApp(): PIXI.Application {
        return this.app;
    }
}
