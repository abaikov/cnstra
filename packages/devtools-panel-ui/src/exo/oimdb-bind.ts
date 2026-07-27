/**
 * Thin OIMDB→panel bridge.
 *
 * `@oimdb/exodra` 0.4 redesigned its surface around a bindable-centric collection
 * view (`exoCollection` / `exoBindable` / `exoDb`). The panel's data layer was
 * written against the earlier flat read/subscribe helpers and feeds them into
 * `keyedList` and hand-rolled bindables. Rather than rewrite every consumer, this
 * module re-implements those flat helpers directly over `@oimdb/core` primitives
 * (exactly what the old bridge did internally) and re-exports the one primitive
 * that survived the redesign, `combine` (now `exoCombine`).
 *
 * New code (e.g. the durable-runs admin) can use the richer `@oimdb/exodra` API
 * directly; this only keeps the existing panel green on the new versions.
 */
import type { TOIMKey } from '@oimdb/core';
import { exoCombine } from '@oimdb/exodra';

/** `combine([...bindables], fn)` — unchanged contract, now the new primitive. */
export const combine = exoCombine;

type TCollectionLike<TEntity, TPk extends TOIMKey> = {
    getOneByPk(pk: TPk): TEntity | undefined;
    subscribeOnKey(pk: TPk, handler: () => void): () => void;
};

type TIndexLike<TKey, TPk extends TOIMKey> = {
    getPksByKey(key: TKey): readonly TPk[] | ReadonlySet<TPk>;
    subscribeOnKey(key: TKey, handler: () => void): () => void;
};

const toArray = <TPk>(pks: readonly TPk[] | ReadonlySet<TPk>): TPk[] =>
    Array.isArray(pks) ? (pks as TPk[]).slice() : [...(pks as ReadonlySet<TPk>)];

/** Entities for one index key, length-aligned with holes (missing → undefined). */
export function readEntitiesByIndexKey<TEntity, TPk extends TOIMKey, TKey>(
    collection: TCollectionLike<TEntity, TPk>,
    index: TIndexLike<TKey, TPk>,
    key: TKey
): (TEntity | undefined)[] {
    return toArray(index.getPksByKey(key)).map(pk => collection.getOneByPk(pk));
}

/** Subscribe to membership changes of one index key. Returns unsubscribe. */
export function subscribeEntitiesByIndexKey<TEntity, TPk extends TOIMKey, TKey>(
    _collection: TCollectionLike<TEntity, TPk>,
    index: TIndexLike<TKey, TPk>,
    key: TKey,
    onChange: () => void
): () => void {
    return index.subscribeOnKey(key, onChange);
}

/** One entity by primary key. */
export function readEntityByPk<TEntity, TPk extends TOIMKey>(
    collection: TCollectionLike<TEntity, TPk>,
    pk: TPk
): TEntity | undefined {
    return collection.getOneByPk(pk);
}

/** Subscribe to changes of one entity by primary key. Returns unsubscribe. */
export function subscribeEntityByPk<TEntity, TPk extends TOIMKey>(
    collection: TCollectionLike<TEntity, TPk>,
    pk: TPk,
    onChange: () => void
): () => void {
    return collection.subscribeOnKey(pk, onChange);
}

/** Just the membership (primary keys) of one index key. */
export function readPksByIndexKey<TPk extends TOIMKey, TKey>(
    index: TIndexLike<TKey, TPk>,
    key: TKey
): TPk[] {
    return toArray(index.getPksByKey(key));
}

/** Subscribe to membership changes of one index key. Returns unsubscribe. */
export function subscribePksByIndexKey<TPk extends TOIMKey, TKey>(
    index: TIndexLike<TKey, TPk>,
    key: TKey,
    onChange: () => void
): () => void {
    return index.subscribeOnKey(key, onChange);
}
