import type { TExoChildrenPort } from '@exodra/core';
import type { TExoKeyedList } from '@exodra/list-reconcile';
import type { TCNSListPaging } from './TCNSListPaging';
import type { TCNSDevToolsNode } from './TCNSDevToolsNode';
import type { TCNSListItems } from './TCNSListItems';
import type { TCNSListRow } from './TCNSListRow';
import type { TCNSListName } from '../model/types/TCNSListName';

export type TCNSWindowedListOptions = {
    listName: TCNSListName;
    queryKeyOf?(c: TCNSDevToolsNode): string;
    itemsOf(c: TCNSDevToolsNode, paging: TCNSListPaging): TCNSListItems<unknown>;
    openRows(c: TCNSDevToolsNode, port: TExoChildrenPort): TExoKeyedList<TCNSListRow<unknown>>;
};
