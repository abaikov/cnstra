import type { OIMSingleSourceTrackingComputedService } from '@oimdb/core';
import type { TCNSHomeostasisState } from '@cnstra/sync';

export type TCNSOIMDBHomeostasisSourceTrackingComputedStoreAggregate<TKey> = ReturnType<
    OIMSingleSourceTrackingComputedService<TCNSHomeostasisState<TKey | undefined>>['createStoreAggregate']
>;
