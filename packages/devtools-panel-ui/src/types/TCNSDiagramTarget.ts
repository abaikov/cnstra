import type { TCNSNavigationEntryState } from '../model/types/TCNSNavigationEntryState';
import type { TCNSDiagramNodeKind } from './TCNSDiagramNodeKind';
import type { TCNSDiagramStatus } from './TCNSDiagramStatus';

export type TCNSDiagramTarget = {
    id: string;
    kind: TCNSDiagramNodeKind;
    title: string;
    sub?: string;
    weight: number;
    status: TCNSDiagramStatus;
    opens?: TCNSNavigationEntryState;
};
