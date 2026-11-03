import { createOIMSlotCollectionService, createOIMEntityContentService, OIMSlotAtUnholdReleasePolicy } from '@oimdb/core';
import type { OIMDB } from '@oimdb/core';
import type { TCNSHomeostatCorrectionState } from '@cnstra/sync';
import type { TCNSOIMDBHomeostatKey } from '../types/TCNSOIMDBHomeostatKey';
import type { TCNSOIMDBHomeostatCorrectionStoreSlotOptions } from '../types/TCNSOIMDBHomeostatCorrectionStoreSlotOptions';

export function createCNSOIMDBHomeostatCorrectionStoreSlot(db: OIMDB, homeostatCorrectionStoreSlotOptions?: TCNSOIMDBHomeostatCorrectionStoreSlotOptions) {
    const homeostatCorrectionService = createOIMSlotCollectionService({
        ...homeostatCorrectionStoreSlotOptions,
        slotReleasePolicy: homeostatCorrectionStoreSlotOptions?.slotReleasePolicy ?? OIMSlotAtUnholdReleasePolicy.INSTANCE,
        slotContentService: createOIMEntityContentService<TCNSHomeostatCorrectionState<TCNSOIMDBHomeostatKey>, string>(),
    });
    return homeostatCorrectionService.createStoreSlot(db);
}
