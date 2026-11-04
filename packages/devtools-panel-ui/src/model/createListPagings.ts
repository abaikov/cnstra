import { createOIMEntitySlotCollectionStoreAggregate, createOIMReplacingEntityWriter } from '@oimdb/core';
import type { OIMDB } from '@oimdb/core';
import { isCNSHomeostatSameValue } from '@cnstra/sync';
import type { TCNSListPagingState } from './types/TCNSListPagingState';

export function createListPagings(db: OIMDB) {
    return createOIMEntitySlotCollectionStoreAggregate<TCNSListPagingState>(db, {
        entityWriter: createOIMReplacingEntityWriter({ sameValueGuard: isCNSHomeostatSameValue }),
    });
}
