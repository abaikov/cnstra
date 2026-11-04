import { collateral } from '@cnstra/core';
import type { TCNSListPaging } from '../../types/TCNSListPaging';
import type { TCNSListName } from '../types/TCNSListName';

export const listPagingAxon = {
    nextPageListed: collateral<{ listName: TCNSListName; paging: TCNSListPaging }>(),
    newestListed: collateral<{ listName: TCNSListName }>(),
};
