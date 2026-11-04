import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';

export const CLEAR_SELECTION = {
    selected: undefined,
    selectedNeuron: undefined,
    selectedCollateral: undefined,
    selectedTask: undefined,
} satisfies Partial<TCNSExplorerQuery>;
