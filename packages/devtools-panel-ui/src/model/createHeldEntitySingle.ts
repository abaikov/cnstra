import { createOIMEntityContentService, createOIMReplacingEntityWriter, createOIMSingleSlotStoreAggregate } from '@oimdb/core';
import type { OIMDB } from '@oimdb/core';

export function createHeldEntitySingle<TEntity extends object>(db: OIMDB, initialEntity: TEntity) {
    const single = createOIMSingleSlotStoreAggregate(db, {
        slotContentService: createOIMEntityContentService<TEntity>({ entityWriter: createOIMReplacingEntityWriter() }),
    });
    single.writeSingleSlotContent(initialEntity);
    single.holdSingleSlot();
    return single;
}
