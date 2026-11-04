import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatModelHandle } from './TCNSHomeostatModelHandle';
import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';

export type TCNSHomeostatModelEntityReader<
    THandles extends ICNSHomeostatModelHandles,
    TEntity extends object,
    TId extends string | number,
    TKey extends TCNSHomeostatModelKey,
> = {
    readonly collection: TCNSHomeostatModelHandle<THandles, 'entityCollection', { readonly entity: TEntity }>;
    readonly homeostasis: TCNSHomeostatModelHandle<THandles, 'homeostasis', { readonly key: TKey }>;
    keyOf(id: TId): TKey;
};
