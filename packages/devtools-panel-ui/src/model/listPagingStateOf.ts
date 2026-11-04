import type { TCNSListName } from './types/TCNSListName';
import type { TCNSListPagings } from './types/TCNSListPagings';
import type { TCNSListPagingState } from './types/TCNSListPagingState';

export function listPagingStateOf(listPagings: TCNSListPagings, listName: TCNSListName): TCNSListPagingState | undefined {
    return listPagings.getSlotByKey(listName).entity;
}
