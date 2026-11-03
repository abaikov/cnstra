import type { OIMComputedService, TOIMComputedSlot, TOIMSlotStoreTree } from '@oimdb/core';
import type { TCNSHomeostasisState } from '@cnstra/sync';
import type { TCNSOIMDBHomeostatKey } from './TCNSOIMDBHomeostatKey';

export type TCNSOIMDBHomeostasisComputedStoreAggregate<TKey extends NonNullable<unknown>> = ReturnType<
    OIMComputedService<TKey, TCNSHomeostasisState<TKey>, TOIMSlotStoreTree<TOIMComputedSlot<TCNSHomeostasisState<TKey>, TKey>, TCNSOIMDBHomeostatKey[number]>>['createStoreAggregate']
>;
