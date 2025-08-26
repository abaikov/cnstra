import * as PIXI from 'pixi.js';
import { GraphLayout } from './graph/layout';
import { GraphRenderer } from './graph/renderer';
import { EventEngine } from './engine/events';

export interface DevToolsPanelProps {
    channelName?: string;
    width?: number;
    height?: number;
}

export class CNSDevToolsPanel {
    private props: DevToolsPanelProps;
    private container: HTMLDivElement;
    private app?: PIXI.Application;
    private eventEngine?: EventEngine;

    constructor(props: DevToolsPanelProps) {
        this.props = props;
        this.container = document.createElement('div');
        this.container.style.width = `${props.width}px`;
        this.container.style.height = `${props.height}px`;
        this.container.style.position = 'relative';

        this.initialize();
    }

    private async initialize() {
        try {
            // Initialize PixiJS app
            this.app = new PIXI.Application({
                width: this.props.width,
                height: this.props.height,
                backgroundColor: 0x0a0a0a,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
            });

            this.container.appendChild(this.app.view as any);

            // Initialize graph components
            const layout = new GraphLayout();
            const renderer = new GraphRenderer(this.app, layout);
            this.eventEngine = new EventEngine(
                this.props.channelName || 'cns-devtools',
                renderer
            );

            // Start event processing
            this.eventEngine.start();

            // Add some demo nodes for testing
            const demoNodes = [
                {
                    id: '1',
                    label: 'Input',
                    group: 'input',
                    color: '#7fffd4',
                    layer: 0,
                    width: 120,
                    height: 80,
                },
                {
                    id: '2',
                    label: 'Process',
                    group: 'compute',
                    color: '#ff7f7f',
                    layer: 1,
                    width: 120,
                    height: 80,
                },
                {
                    id: '3',
                    label: 'Output',
                    group: 'output',
                    color: '#7f7fff',
                    layer: 2,
                    width: 120,
                    height: 80,
                },
            ];

            const demoEdges = [
                { id: '1-2', source: '1', target: '2', label: 'input→compute' },
                {
                    id: '2-3',
                    source: '2',
                    target: '3',
                    label: 'compute→output',
                },
            ];

            await renderer.renderGraph(demoNodes, demoEdges);
        } catch (error) {
            console.error('Failed to initialize CNSDevToolsPanel:', error);
        }
    }

    render(): HTMLElement {
        return this.container;
    }

    destroy() {
        if (this.eventEngine) {
            this.eventEngine.stop();
        }
        if (this.app) {
            this.app.destroy(true);
        }
        if (this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}
