import type { TOIMEntityContentSlot } from '@oimdb/core';

export type TCNSOIMDBHomeostatFiringPolicyOptions = {
    onlineSlot?: TOIMEntityContentSlot<{ readonly isOnline: boolean }>;
    visibilitySlot?: TOIMEntityContentSlot<{ readonly isVisible: boolean }>;
};
