import { ICNSDevToolsPanel } from './interfaces/ICNSDevToolsPanel';

export interface DevToolsPanelProps {
    channelName?: string;
    width?: number;
    height?: number;
}

export class CNSDevToolsPanel implements ICNSDevToolsPanel {
    private props: DevToolsPanelProps;
    private container: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private eventChannel?: BroadcastChannel;
    private animationId?: number;

    constructor(props: DevToolsPanelProps) {
        this.props = props;
        this.container = document.createElement('div');
        this.container.style.width = `${props.width}px`;
        this.container.style.height = `${props.height}px`;
        this.container.style.position = 'relative';
        this.container.style.background = '#0a0a0a';
        this.container.style.border = '2px solid #333';
        this.container.style.borderRadius = '10px';

        this.canvas = document.createElement('canvas');
        this.canvas.width = props.width || 1200;
        this.canvas.height = props.height || 800;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';

        this.ctx = this.canvas.getContext('2d')!;
        this.container.appendChild(this.canvas);

        this.initialize();
    }

    private initialize() {
        try {
            // Initialize event channel
            this.eventChannel = new BroadcastChannel(
                this.props.channelName || 'cns-devtools'
            );
            this.eventChannel.onmessage = this.handleEvent.bind(this);

            // Start rendering loop
            this.startRenderLoop();

            // Draw initial demo graph
            this.drawDemoGraph();
        } catch (error) {
            console.error('Failed to initialize CNSDevToolsPanel:', error);
        }
    }

    private handleEvent(event: MessageEvent) {
        const data = event.data;
        console.log('Received event:', data);

        // Handle different event types
        if (data.kind === 'enqueue') {
            this.animateSignal(data.spikeId, data.toType);
        }
    }

    private startRenderLoop() {
        const animate = () => {
            this.renderCanvas();
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }

    private renderCanvas() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw demo graph
        this.drawDemoGraph();
    }

    private drawDemoGraph() {
        const { width, height } = this.canvas;

        // Draw nodes
        const nodes = [
            {
                x: width * 0.2,
                y: height * 0.5,
                label: 'Input',
                color: '#7fffd4',
            },
            {
                x: width * 0.5,
                y: height * 0.5,
                label: 'Process',
                color: '#ff7f7f',
            },
            {
                x: width * 0.8,
                y: height * 0.5,
                label: 'Output',
                color: '#7f7fff',
            },
        ];

        // Draw edges
        this.ctx.strokeStyle = '#7fffd4';
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 0.6;

        for (let i = 0; i < nodes.length - 1; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(nodes[i].x + 40, nodes[i].y);
            this.ctx.lineTo(nodes[i + 1].x - 40, nodes[i + 1].y);
            this.ctx.stroke();
        }

        // Draw nodes
        nodes.forEach(node => {
            // Node background
            this.ctx.fillStyle = node.color;
            this.ctx.globalAlpha = 0.8;
            this.ctx.fillRect(node.x - 40, node.y - 30, 80, 60);

            // Node border
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.8;
            this.ctx.strokeRect(node.x - 40, node.y - 30, 80, 60);

            // Node label
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '14px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.globalAlpha = 1;
            this.ctx.fillText(node.label, node.x, node.y + 5);
        });

        // Reset alpha
        this.ctx.globalAlpha = 1;
    }

    private animateSignal(spikeId: string, type: string) {
        // Simple signal animation
        const { width, height } = this.canvas;

        // Create a particle effect
        const particle = {
            x: width * 0.2,
            y: height * 0.5,
            vx: (width * 0.6) / 60, // Move across screen in 1 second
            vy: 0,
            life: 60,
        };

        const animateParticle = () => {
            if (particle.life <= 0) return;

            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life--;

            // Draw particle
            this.ctx.fillStyle = '#ffff00';
            this.ctx.globalAlpha = particle.life / 60;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
            this.ctx.fill();

            // Continue animation
            if (particle.life > 0) {
                requestAnimationFrame(animateParticle);
            }
        };

        animateParticle();
    }

    render(): HTMLElement {
        return this.container;
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        if (this.eventChannel) {
            this.eventChannel.close();
        }
        if (this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}
