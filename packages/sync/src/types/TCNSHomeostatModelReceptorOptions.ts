import type { ICNSCollateral, TCNSAxon, TCNSSignal } from '@cnstra/types';
import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';

export type TCNSHomeostatModelReceptorOptions<
    TAxon extends Record<string, ICNSCollateral<unknown>>,
    TCollections extends Record<string, object>,
    TKey extends TCNSHomeostatModelKey,
    TData,
    TSummary extends object,
    TBucketCollectionName extends keyof TCollections,
> = {
    readonly homeostatReceptor: CNSHomeostatReceptor<TKey, TData>;
    readonly bucketsOf?: (data: TData) => { readonly [TCollectionName in TBucketCollectionName]: readonly TCollections[TCollectionName][] };
    readonly entitiesOf?: (data: TData) => { readonly [TCollectionName in keyof TCollections]?: readonly TCollections[TCollectionName][] };
    readonly summaryOf?: (data: TData) => TSummary;
    readonly isSameValue?: (previous: unknown, next: unknown) => boolean;
    readonly keepAfterIdleMs?: number;
    readonly afterWrite?: (
        homeostatWrite: {
            readonly key: TKey;
            readonly data: TData;
            readonly insertedEntities: { readonly [TCollectionName in keyof TCollections]: readonly TCollections[TCollectionName][] };
            readonly changedEntities: { readonly [TCollectionName in keyof TCollections]: readonly TCollections[TCollectionName][] };
            readonly isBucketChanged: boolean;
            readonly isSummaryChanged: boolean;
        },
        axon: TCNSAxon<TAxon>
    ) => TCNSSignal<TCNSAxon<TAxon>[keyof TAxon]> | undefined;
};
