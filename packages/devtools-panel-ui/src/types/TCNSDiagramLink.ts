import type { TCNSDiagramTarget } from './TCNSDiagramTarget';

export type TCNSDiagramLink = {
    target: TCNSDiagramTarget;
    nodeTransform: string;
    edgePath: string;
    midX: number;
    midY: number;
    share: number;
};
