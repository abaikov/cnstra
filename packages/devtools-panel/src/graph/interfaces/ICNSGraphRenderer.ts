import { TCNSGraphNode, TCNSGraphEdge } from '../layout';
import * as PIXI from 'pixi.js';

export interface ICNSGraphRenderer {
    renderGraph(nodes: TCNSGraphNode[], edges: TCNSGraphEdge[]): Promise<void>;
    animateSignal(edgeId: string, duration?: number): void;
    getEdge(edgeId: string): PIXI.Graphics | undefined;
    getApp(): PIXI.Application;
}
