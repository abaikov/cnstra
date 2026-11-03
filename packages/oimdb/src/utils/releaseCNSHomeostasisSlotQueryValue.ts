import type { CNSHomeostatRegulator } from '@cnstra/sync';
import type { TCNSOIMDBHomeostasisSlotQuery } from '../types/TCNSOIMDBHomeostasisSlotQuery';

export function releaseCNSHomeostasisSlotQueryValue<TKey extends readonly unknown[], TData, THomeostasisState, TSlotQuery extends TCNSOIMDBHomeostasisSlotQuery<TKey, TData>>(
    homeostatRegulator: CNSHomeostatRegulator<TKey, TData>,
    slotQueryByHomeostasisState: Map<THomeostasisState, TSlotQuery>,
    homeostasisState: THomeostasisState
): TSlotQuery | undefined {
    const slotQuery = slotQueryByHomeostasisState.get(homeostasisState);
    if (slotQuery === undefined) return undefined;
    slotQueryByHomeostasisState.delete(homeostasisState);
    if (slotQuery.homeostasisQuery.homeostasisState !== homeostasisState) return undefined;
    homeostatRegulator.release(slotQuery.homeostasisQuery);
    return slotQuery;
}
