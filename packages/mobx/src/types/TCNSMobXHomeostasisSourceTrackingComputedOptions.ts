import type { TCNSHomeostatSource } from '@cnstra/sync';

export type TCNSMobXHomeostasisSourceTrackingComputedOptions<TKey, TData> = {
    getHomeostatSource: () => TCNSHomeostatSource<TKey, TData> | undefined;
};
