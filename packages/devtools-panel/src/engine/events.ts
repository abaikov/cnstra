import { GraphRenderer } from '../graph/renderer';
import { ICNSEventEngine } from './interfaces/ICNSEventEngine';
import { CNSParticleSystem } from './particles/CNSParticleSystem';

type DevEvent =
    | {
          kind: 'stage';
          stage: string;
          spikeId: string;
          type: string;
          hops: number;
          t: number;
      }
    | {
          kind: 'enqueue';
          spikeId: string;
          toType: string;
          hops: number;
          t: number;
      }
    | {
          kind: 'error';
          stage: string;
          spikeId: string;
          error: string;
          t: number;
      };

export class EventEngine implements ICNSEventEngine {
    private channel: BroadcastChannel;
    private renderer: GraphRenderer;
    private particleSystem: CNSParticleSystem;
    private isRunning: boolean = false;
    private eventBuffer: DevEvent[] = [];
    private animationFrameId?: number;

    constructor(channelName: string, renderer: GraphRenderer) {
        this.channel = new BroadcastChannel(channelName);
        this.renderer = renderer;
        this.particleSystem = new CNSParticleSystem(
            renderer.getApp(),
            renderer
        );
    }

    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.channel.onmessage = this.handleMessage.bind(this);
        this.startAnimationLoop();
    }

    stop() {
        this.isRunning = false;
        this.channel.onmessage = null;
        this.channel.close();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    private handleMessage(event: MessageEvent<DevEvent>) {
        const devEvent = event.data;
        this.eventBuffer.push(devEvent);

        // Limit buffer size to prevent memory issues
        if (this.eventBuffer.length > 1000) {
            this.eventBuffer = this.eventBuffer.slice(-500);
        }
    }

    private startAnimationLoop() {
        let lastTime = performance.now();

        const animate = (currentTime: number) => {
            if (!this.isRunning) return;

            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;

            this.processEvents();
            this.particleSystem.update(deltaTime);

            this.animationFrameId = requestAnimationFrame(animate);
        };

        animate(performance.now());
    }

    private processEvents() {
        if (this.eventBuffer.length === 0) return;

        // Process events in batches to avoid overwhelming the renderer
        const batchSize = Math.min(10, this.eventBuffer.length);
        const batch = this.eventBuffer.splice(0, batchSize);

        batch.forEach(event => {
            this.processEvent(event);
        });
    }

    private processEvent(event: DevEvent) {
        switch (event.kind) {
            case 'enqueue':
                this.handleEnqueueEvent(event);
                break;
            case 'error':
                this.handleErrorEvent(event);
                break;
            case 'stage':
                this.handleStageEvent(event);
                break;
        }
    }

    private handleEnqueueEvent(event: DevEvent) {
        // Spawn particles on edges that match the target type
        // For now, spawn on all edges (can be optimized later)
        this.particleSystem.spawnParticles('edge-' + event.spikeId);
    }

    private handleErrorEvent(event: DevEvent) {
        // TODO: Visualize errors (e.g., red flash on nodes)
        console.warn('CNS Error:', event);
    }

    private handleStageEvent(event: DevEvent) {
        // TODO: Update node states based on processing stage
        // For now, just log for debugging
        if (event.kind === 'stage' && event.stage === 'postGate') {
            console.debug(
                `Signal ${event.spikeId} processed at ${event.stage}`
            );
        }
    }

    // Method to set graph data (called from external source)
    setGraphData(nodes: unknown[], edges: unknown[]) {
        this.renderer.renderGraph(
            nodes as import('../graph/layout').TCNSGraphNode[],
            edges as import('../graph/layout').TCNSGraphEdge[]
        );
    }
}
