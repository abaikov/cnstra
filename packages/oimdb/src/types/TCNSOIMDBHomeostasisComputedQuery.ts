import type { TOIMSlot } from '@oimdb/core';
import type { TCNSHomeostatSource } from '@cnstra/sync';
import type { TCNSOIMDBHomeostasisSlotQuery } from './TCNSOIMDBHomeostasisSlotQuery';
import type { TCNSOIMDBHomeostatCorrectionSlot } from './TCNSOIMDBHomeostatCorrectionSlot';

export type TCNSOIMDBHomeostasisComputedQuery<TKey, TData> = TCNSOIMDBHomeostasisSlotQuery<TKey, TData> & {
    homeostasisSlot: TOIMSlot;
    homeostatSource: TCNSHomeostatSource<TKey, TData>;
    homeostatCorrectionSlot: TCNSOIMDBHomeostatCorrectionSlot;
};
