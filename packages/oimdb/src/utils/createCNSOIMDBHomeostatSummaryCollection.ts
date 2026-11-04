import {
    createOIMEntityContentService,
    createOIMReplacingEntityWriter,
    createOIMSlotCollectionService,
    OIMScalarKeyTreeWalk,
    OIMSlotTreeStoreService,
} from '@oimdb/core';
import type { IOIMSlotReleasePolicy, IOIMSlotSubscriptionListener, OIMDB, OIMEntityContentService, TOIMEntitySlot, TOIMSameValueGuard, TOIMSlotStoreTree } from '@oimdb/core';
import type { TCNSOIMDBHomeostatKey } from '../types/TCNSOIMDBHomeostatKey';

export function createCNSOIMDBHomeostatSummaryCollection<TSummary extends object>(
    db: OIMDB,
    sameValueGuard: TOIMSameValueGuard,
    slotSubscriptionListener: IOIMSlotSubscriptionListener | undefined,
    slotReleasePolicy: IOIMSlotReleasePolicy
) {
    const valueCollectionService = createOIMSlotCollectionService<
        OIMEntityContentService<TSummary, TCNSOIMDBHomeostatKey>,
        TOIMSlotStoreTree<TOIMEntitySlot<TSummary, TCNSOIMDBHomeostatKey>, TCNSOIMDBHomeostatKey[number]>,
        string,
        TCNSOIMDBHomeostatKey,
        TOIMEntitySlot<TSummary, TCNSOIMDBHomeostatKey>,
        TSummary
    >({
        slotContentService: createOIMEntityContentService<TSummary, TCNSOIMDBHomeostatKey>({ entityWriter: createOIMReplacingEntityWriter({ sameValueGuard }) }),
        slotStoreService: new OIMSlotTreeStoreService<TCNSOIMDBHomeostatKey[number], TOIMEntitySlot<TSummary, TCNSOIMDBHomeostatKey>>(OIMScalarKeyTreeWalk.INSTANCE),
        slotSubscriptionListener,
        slotReleasePolicy,
    });
    return valueCollectionService.createStoreAggregate(valueCollectionService.createStoreSlot(db));
}
