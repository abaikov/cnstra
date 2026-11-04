import type { TExoMachine, TExoMachineTransitions } from '@exodra/core';
import type { TCNSListItems } from '../../types/TCNSListItems';
import type { TCNSListRow } from '../../types/TCNSListRow';
import type { TCNSWindowedListOptions } from '../../types/TCNSWindowedListOptions';
import type { TCNSListPaging } from '../../types/TCNSListPaging';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';
import type { TCNSListName } from '../../model/types/TCNSListName';

type TCNSListRowMachine<TItem> = TExoMachine<TCNSDevToolsNode, unknown, TCNSListRow<TItem>> & {
    readonly transitions: TExoMachineTransitions<TCNSDevToolsNode, { setRow: [TCNSListRow<TItem>] }>;
};

export const createWindowedListOptions = <TItem,>(options: {
    listName: TCNSListName;
    queryKeyOf?: (c: TCNSDevToolsNode) => string;
    itemsOf: (c: TCNSDevToolsNode, paging: TCNSListPaging) => TCNSListItems<TItem>;
    keyOf: (item: TItem) => string;
    rowMachine: TCNSListRowMachine<TItem>;
}): TCNSWindowedListOptions => {
    const { listName, queryKeyOf, itemsOf, keyOf, rowMachine } = options;
    const { setRow } = rowMachine.transitions;
    return {
        listName,
        queryKeyOf,
        itemsOf,
        openRows: (c, port) =>
            c.keyedList(
                port,
                (row: TCNSListRow<TItem>) => keyOf(row.item),
                row => c.build(rowMachine, row),
                setRow
            ),
    };
};
