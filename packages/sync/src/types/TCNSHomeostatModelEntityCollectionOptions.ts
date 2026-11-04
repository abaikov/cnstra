import type { TCNSHomeostatModelSummaryCollectionOptions } from './TCNSHomeostatModelSummaryCollectionOptions';

export type TCNSHomeostatModelEntityCollectionOptions<TEntity extends object, TReceptiveDemand> = TCNSHomeostatModelSummaryCollectionOptions<TReceptiveDemand> & {
    readonly idOf: (entity: TEntity) => string | number;
};
