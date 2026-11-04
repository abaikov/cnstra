import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { TCNSHomeostatModelKey } from './TCNSHomeostatModelKey';
import type { TCNSHomeostatModelCollectionReceptor } from './TCNSHomeostatModelCollectionReceptor';

export type TCNSHomeostatModelCollectionOptions<TEntity extends object, TId extends string | number, TKey extends TCNSHomeostatModelKey> = {
    readonly idOf: (entity: TEntity) => TId;
    readonly isNewer?: (incoming: TEntity, current: TEntity) => boolean;
    readonly isSameValue?: (previous: unknown, next: unknown) => boolean;
    readonly keepAfterIdleMs?: number;
    readonly homeostatReceptor?: CNSHomeostatReceptor<[TId], TEntity> | TCNSHomeostatModelCollectionReceptor<TEntity, TId, TKey>;
};
