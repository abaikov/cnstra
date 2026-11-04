import type { TCNSDiagramNodeKind } from './TCNSDiagramNodeKind';
import type { TCNSDiagramTarget } from './TCNSDiagramTarget';

export type TCNSDiagramConfig = {
    sourceKind: TCNSDiagramNodeKind;
    sourceLabel: string;
    left: TCNSDiagramTarget[];
    right: TCNSDiagramTarget[];
    leftHeading?: string;
    rightHeading?: string;
};
