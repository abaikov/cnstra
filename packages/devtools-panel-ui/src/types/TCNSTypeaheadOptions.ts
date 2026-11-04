import type { TCNSExplorerQuery } from './TCNSExplorerQuery';
import type { TCNSDevToolsNode } from './TCNSDevToolsNode';

export type TCNSTypeaheadOptions = {
    placeholder: string;
    namesOf(c: TCNSDevToolsNode): string[];
    patchOf(name: string): Partial<TCNSExplorerQuery>;
};
