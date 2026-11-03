import type { TOIMKeyedSlot } from '@oimdb/core';

export type TCNSOIMDBHomeostatReceptiveFieldOptions<TKey, TSlotKey extends {}, TSlot extends TOIMKeyedSlot<TSlotKey> = TOIMKeyedSlot<TSlotKey>> = {
    selectKey: (slotKey: TSlotKey) => TKey;
    isSlotDemanded?: (slot: TSlot) => boolean;
};
