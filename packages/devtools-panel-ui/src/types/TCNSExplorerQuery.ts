import type { TCNSExplorerTab } from './TCNSExplorerTab';

export type TCNSExplorerQuery = {
    scopeName?: string;
    status?: string;
    entryCollateralName?: string;
    neuronName?: string;
    text?: string;
    since?: number;
    until?: number;
    entryOnly?: boolean;
    tab: TCNSExplorerTab;
    selected?: string;
    selectedNeuron?: string;
    selectedCollateral?: string;
    selectedTask?: string;
    navTrail?: string[];
    metricPath?: string;
};
