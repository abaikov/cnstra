import type { neuron } from '@cnstra/core';
import type { ICNSCollateral, TCNSAxon, TCNSDendrite } from '@cnstra/types';
import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatModelEntityReader } from './TCNSHomeostatModelEntityReader';
import type { TCNSHomeostatModelHandle } from './TCNSHomeostatModelHandle';
import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';

type TCNSHomeostatModelReceptorKeyOf<TReceptor> = TReceptor extends { readonly key: infer TKey extends TCNSHomeostatModelKey } ? TKey : never;

type TCNSHomeostatModelReceptorSummaryOf<TReceptor> = TReceptor extends { readonly summary: infer TSummary extends object } ? TSummary : never;

type TCNSHomeostatModelReceptorEntityIdOf<TReceptor> = TReceptor extends { readonly entityId: infer TId extends string | number } ? TId : never;

type TCNSHomeostatModelReceptorBucketCollectionNameOf<TReceptor, TCollections> =
    TReceptor extends { readonly bucketCollectionName: infer TBucketCollectionName extends keyof TCollections } ? TBucketCollectionName : never;

export type TCNSHomeostatModel<
    TAxon extends Record<string, ICNSCollateral<unknown>>,
    TCollections extends Record<string, object>,
    TReceptors extends Record<string, unknown>,
    THandles extends ICNSHomeostatModelHandles,
> = {
    readonly collections: {
        readonly [TCollectionName in keyof TCollections]: TCNSHomeostatModelHandle<THandles, 'entityCollection', { readonly entity: TCollections[TCollectionName] }>;
    };
    readonly buckets: {
        readonly [TReceptorName in keyof TReceptors as [TCNSHomeostatModelReceptorBucketCollectionNameOf<TReceptors[TReceptorName], TCollections>] extends [never] ? never : TReceptorName]: {
            readonly [TCollectionName in TCNSHomeostatModelReceptorBucketCollectionNameOf<TReceptors[TReceptorName], TCollections>]:
                TCNSHomeostatModelHandle<THandles, 'bucketCollection', { readonly entity: TCollections[TCollectionName] }>;
        };
    };
    readonly summaries: {
        readonly [TReceptorName in keyof TReceptors as [TCNSHomeostatModelReceptorSummaryOf<TReceptors[TReceptorName]>] extends [never] ? never : TReceptorName]:
            TCNSHomeostatModelHandle<THandles, 'summaryCollection', { readonly summary: TCNSHomeostatModelReceptorSummaryOf<TReceptors[TReceptorName]> }>;
    };
    readonly homeostasis: {
        readonly [TReceptorName in keyof TReceptors]: TCNSHomeostatModelHandle<THandles, 'homeostasis', { readonly key: TCNSHomeostatModelReceptorKeyOf<TReceptors[TReceptorName]> }>;
    };
    readonly homeostatDendrites: readonly TCNSDendrite<ICNSCollateral<unknown>, TCNSAxon<TAxon>>[];
    createNeuron(): ReturnType<typeof neuron<TAxon>>;
    invalidate(): Promise<void>;
} & {
    readonly [TCollectionName in keyof TReceptors & keyof TCollections as [TCNSHomeostatModelReceptorEntityIdOf<TReceptors[TCollectionName]>] extends [never] ? never : TCollectionName]:
        TCNSHomeostatModelEntityReader<
            THandles,
            TCollections[TCollectionName],
            TCNSHomeostatModelReceptorEntityIdOf<TReceptors[TCollectionName]>,
            TCNSHomeostatModelReceptorKeyOf<TReceptors[TCollectionName]>
        >;
};
