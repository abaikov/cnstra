import { createOIMSlotCollectionService, OIMPositionalArrayBucketContentService, OIMScalarKeyTreeWalk, OIMSlotTreeStoreService } from '@oimdb/core';
import type {
    IOIMSlotReleasePolicy,
    IOIMSlotSubscriptionListener,
    OIMDB,
    TOIMBucketSlot,
    TOIMBucketSlotsArrayStore,
    TOIMEntitySlot,
    TOIMSlotStoreTree,
    TOIMStoreKey,
} from '@oimdb/core';
import type { TCNSOIMDBHomeostatKey } from '../types/TCNSOIMDBHomeostatKey';

export function createCNSOIMDBHomeostatBucketCollection<TEntity extends object>(
    db: OIMDB,
    slotSubscriptionListener: IOIMSlotSubscriptionListener | undefined,
    slotReleasePolicy: IOIMSlotReleasePolicy
) {
    const bucketCollectionService = createOIMSlotCollectionService<
        OIMPositionalArrayBucketContentService<TOIMEntitySlot<TEntity, TOIMStoreKey>, TCNSOIMDBHomeostatKey>,
        TOIMSlotStoreTree<TOIMBucketSlot<TOIMBucketSlotsArrayStore<TOIMEntitySlot<TEntity, TOIMStoreKey>>, TCNSOIMDBHomeostatKey>, TCNSOIMDBHomeostatKey[number]>,
        string,
        TCNSOIMDBHomeostatKey,
        TOIMBucketSlot<TOIMBucketSlotsArrayStore<TOIMEntitySlot<TEntity, TOIMStoreKey>>, TCNSOIMDBHomeostatKey>,
        readonly TOIMEntitySlot<TEntity, TOIMStoreKey>[]
    >({
        slotContentService: new OIMPositionalArrayBucketContentService<TOIMEntitySlot<TEntity, TOIMStoreKey>, TCNSOIMDBHomeostatKey>(),
        slotStoreService: new OIMSlotTreeStoreService<
            TCNSOIMDBHomeostatKey[number],
            TOIMBucketSlot<TOIMBucketSlotsArrayStore<TOIMEntitySlot<TEntity, TOIMStoreKey>>, TCNSOIMDBHomeostatKey>
        >(OIMScalarKeyTreeWalk.INSTANCE),
        slotSubscriptionListener,
        slotReleasePolicy,
    });
    return bucketCollectionService.createStoreAggregate(bucketCollectionService.createStoreSlot(db));
}
