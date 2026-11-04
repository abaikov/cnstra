import type { CNSHomeostatForwardingCNS } from '../CNSHomeostatForwardingCNS';
import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { ICNSHomeostatModelHandles } from './ICNSHomeostatModelHandles';
import type { TCNSHomeostatModelBucketCollection } from '../types/TCNSHomeostatModelBucketCollection';
import type { TCNSHomeostatModelEntityCollection } from '../types/TCNSHomeostatModelEntityCollection';
import type { TCNSHomeostatModelEntityCollectionOptions } from '../types/TCNSHomeostatModelEntityCollectionOptions';
import type { TCNSHomeostatModelHandle } from '../types/TCNSHomeostatModelHandle';
import type { TCNSHomeostatModelKey } from '../types/TCNSHomeostatModelKey';
import type { TCNSHomeostatModelReceptiveDemand } from '../types/TCNSHomeostatModelReceptiveDemand';
import type { TCNSHomeostatModelReceptiveDemandOptions } from '../types/TCNSHomeostatModelReceptiveDemandOptions';
import type { TCNSHomeostatModelSummaryCollection } from '../types/TCNSHomeostatModelSummaryCollection';
import type { TCNSHomeostatModelSummaryCollectionOptions } from '../types/TCNSHomeostatModelSummaryCollectionOptions';

export interface ICNSHomeostatModelBinding<THandles extends ICNSHomeostatModelHandles> {
    createEnvironment(cns: CNSHomeostatForwardingCNS): THandles['homeostatEnvironment'];
    createReceptiveDemand<TKey extends TCNSHomeostatModelKey, TData, TEntryKey extends NonNullable<unknown>>(
        homeostatEnvironment: THandles['homeostatEnvironment'],
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: TCNSHomeostatModelReceptiveDemandOptions<TEntryKey, TKey>
    ): TCNSHomeostatModelReceptiveDemand<THandles['receptiveDemand']>;
    createEntityCollection<TEntity extends object>(
        options: TCNSHomeostatModelEntityCollectionOptions<TEntity, THandles['receptiveDemand']>
    ): TCNSHomeostatModelEntityCollection<TEntity, TCNSHomeostatModelHandle<THandles, 'entityCollection', { readonly entity: TEntity }>>;
    createBucketCollection<TEntity extends object>(
        entityCollection: TCNSHomeostatModelEntityCollection<TEntity, TCNSHomeostatModelHandle<THandles, 'entityCollection', { readonly entity: TEntity }>>,
        receptiveDemand: THandles['receptiveDemand'],
        keepAfterIdleMs: number
    ): TCNSHomeostatModelBucketCollection;
    createSummaryCollection<TSummary extends object>(
        options: TCNSHomeostatModelSummaryCollectionOptions<THandles['receptiveDemand']>
    ): TCNSHomeostatModelSummaryCollection<TSummary>;
}
