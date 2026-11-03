import type { TCNSHomeostatSource } from '@cnstra/sync';

export type TCNSOIMDBHomeostasisSourceTrackingComputedOptions<TKey, TData> = {
    getHomeostatSource: () => TCNSHomeostatSource<TKey, TData> | undefined;
};
