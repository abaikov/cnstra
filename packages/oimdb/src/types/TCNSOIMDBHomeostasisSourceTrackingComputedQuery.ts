import type { OIMSingleSourceTrackingComputedService } from '@oimdb/core';
import type { TCNSHomeostatSource } from '@cnstra/sync';
import type { TCNSOIMDBHomeostasisSlotQuery } from './TCNSOIMDBHomeostasisSlotQuery';
import type { TCNSOIMDBHomeostatCorrectionSlot } from './TCNSOIMDBHomeostatCorrectionSlot';

export type TCNSOIMDBHomeostasisSourceTrackingComputedQuery<TKey, TData> = TCNSOIMDBHomeostasisSlotQuery<TKey, TData> & {
    sourceStoreSlot: ReturnType<OIMSingleSourceTrackingComputedService<TCNSHomeostatSource<TKey, TData> | undefined>['createStoreSlot']>;
    homeostatCorrectionSlot: TCNSOIMDBHomeostatCorrectionSlot | undefined;
};
