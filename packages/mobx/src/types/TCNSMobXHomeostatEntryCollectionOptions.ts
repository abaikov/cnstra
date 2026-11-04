import type { TCNSHomeostatModelSummaryCollectionOptions } from '@cnstra/sync';
import type { ICNSMobXHomeostatModelHandles } from '../interfaces/ICNSMobXHomeostatModelHandles';
import type { TCNSMobXHomeostatEntryMemberHold } from './TCNSMobXHomeostatEntryMemberHold';

export type TCNSMobXHomeostatEntryCollectionOptions<TEntryKey, TEntry> = TCNSHomeostatModelSummaryCollectionOptions<ICNSMobXHomeostatModelHandles['receptiveDemand']> & {
    readonly entryKeyHashFn: (entryKey: TEntryKey) => string | number;
    readonly entryMemberHold?: TCNSMobXHomeostatEntryMemberHold<TEntry>;
};
