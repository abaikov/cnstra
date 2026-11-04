import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';

export type TCNSHomeostatModelCollectionReceptor<TEntity extends object, TId extends string | number, TKey extends TCNSHomeostatModelKey> = {
    readonly homeostatReceptor: CNSHomeostatReceptor<TKey, TEntity>;
    readonly keyOf: (id: TId) => NoInfer<TKey>;
};
