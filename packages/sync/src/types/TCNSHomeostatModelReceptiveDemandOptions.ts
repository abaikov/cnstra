import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';

export type TCNSHomeostatModelReceptiveDemandOptions<TEntryKey, TKey extends TCNSHomeostatModelKey> = {
    readonly selectKey: (entryKey: TEntryKey) => TKey;
    readonly isOnlyEmptyEntryDemanded: boolean;
};
