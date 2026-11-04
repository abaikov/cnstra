import { FIRST_PAGE } from '../constants/FIRST_PAGE';
import type { TCNSListPaging } from '../types/TCNSListPaging';
import type { TCNSListPagingState } from './types/TCNSListPagingState';

export function listPagingOf(listPagingState: TCNSListPagingState | undefined, queryKey: string): TCNSListPaging {
    return listPagingState !== undefined && listPagingState.queryKey === queryKey ? listPagingState.paging : FIRST_PAGE;
}
