import type { TOIMEntityContentSlot } from '@oimdb/core';
import type { ICNSHomeostatFiringPolicy } from '@cnstra/sync';

export interface ICNSOIMDBHomeostatFiringPolicy extends ICNSHomeostatFiringPolicy {
    readonly sourceSlots: readonly TOIMEntityContentSlot[];
}
