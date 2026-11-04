import { neuron } from '@cnstra/core';
import type { ICNSCollateral } from '@cnstra/types';
import { CNSHomeostatReceptor } from './CNSHomeostatReceptor';
import type { ICNSHomeostatModelBinding } from './interfaces/ICNSHomeostatModelBinding';
import type { ICNSHomeostatModelDefinition } from './interfaces/ICNSHomeostatModelDefinition';
import type { ICNSHomeostatModelHandles } from './interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatModelBucketCollection } from './types/TCNSHomeostatModelBucketCollection';
import type { TCNSHomeostatModelCollectionOptions } from './types/TCNSHomeostatModelCollectionOptions';
import type { TCNSHomeostatModelCollectionReceptor } from './types/TCNSHomeostatModelCollectionReceptor';
import type { TCNSHomeostatModelCollectionHomeostasis } from './types/TCNSHomeostatModelCollectionHomeostasis';
import type { TCNSHomeostatModelKey } from './types/TCNSHomeostatModelKey';
import type { TCNSHomeostatModelReceptorOptions } from './types/TCNSHomeostatModelReceptorOptions';
import { isCNSHomeostatSameValue } from './utils/isCNSHomeostatSameValue';

const CNS_HOMEOSTAT_MODEL_MEMBER_NAMES: readonly string[] = ['collections', 'buckets', 'summaries', 'homeostasis', 'homeostatDendrites', 'createNeuron'];

type TCNSHomeostatModelDraftCollection<THandles extends ICNSHomeostatModelHandles> = {
    writeEntity(entity: object): 'inserted' | 'changed' | undefined;
    idOf(entity: object): string | number;
    createBucketCollection(receptiveDemand: THandles['receptiveDemand'], keepAfterIdleMs: number): TCNSHomeostatModelBucketCollection;
};

type TCNSHomeostatModelDraft<TAxon extends Record<string, ICNSCollateral<unknown>>, THandles extends ICNSHomeostatModelHandles> = {
    readonly binding: ICNSHomeostatModelBinding<THandles>;
    readonly homeostatEnvironment: THandles['homeostatEnvironment'];
    readonly homeostatDendriteBuilder: ReturnType<typeof neuron<TAxon>>;
    readonly draftCollectionByName: Map<string, TCNSHomeostatModelDraftCollection<THandles>>;
    readonly collections: Record<string, unknown>;
    readonly buckets: Record<string, Record<string, unknown>>;
    readonly summaries: Record<string, unknown>;
    readonly homeostasis: Record<string, unknown>;
    readonly entityReaders: Record<string, unknown>;
    readonly invalidations: (() => Promise<unknown>)[];
};

type TCNSHomeostatModelDraftStep<TAxon extends Record<string, ICNSCollateral<unknown>>> =
    <THandles extends ICNSHomeostatModelHandles>(draft: TCNSHomeostatModelDraft<TAxon, THandles>) => void;

export class CNSHomeostatModelDefinition<
    TAxon extends Record<string, ICNSCollateral<unknown>>,
    TCollections extends Record<string, object>,
    TReceptors extends Record<string, unknown>,
> implements ICNSHomeostatModelDefinition {
    public readonly axon: TAxon;

    public readonly homeostatReceptors: readonly CNSHomeostatReceptor<never, unknown>[];

    private readonly draftSteps: readonly TCNSHomeostatModelDraftStep<TAxon>[];

    public constructor(
        axon: TAxon,
        homeostatReceptors: readonly CNSHomeostatReceptor<never, unknown>[] = [],
        draftSteps: readonly TCNSHomeostatModelDraftStep<TAxon>[] = []
    ) {
        this.axon = axon;
        this.homeostatReceptors = homeostatReceptors;
        this.draftSteps = draftSteps;
    }

    public collection<TName extends string, TEntity extends object, TId extends string | number>(
        name: TName,
        options: TCNSHomeostatModelCollectionOptions<TEntity, TId, never> & { readonly homeostatReceptor: CNSHomeostatReceptor<[TId], TEntity> }
    ): CNSHomeostatModelDefinition<TAxon, TCollections & Record<TName, TEntity>, TReceptors & Record<TName, TCNSHomeostatModelCollectionHomeostasis<[TId], TId>>>;
    public collection<TName extends string, TEntity extends object, TId extends string | number, TKey extends TCNSHomeostatModelKey | []>(
        name: TName,
        options: TCNSHomeostatModelCollectionOptions<TEntity, TId, TKey> & { readonly homeostatReceptor: TCNSHomeostatModelCollectionReceptor<TEntity, TId, TKey> }
    ): CNSHomeostatModelDefinition<TAxon, TCollections & Record<TName, TEntity>, TReceptors & Record<TName, TCNSHomeostatModelCollectionHomeostasis<TKey, TId>>>;
    public collection<TName extends string, TEntity extends object, TId extends string | number>(
        name: TName,
        options: TCNSHomeostatModelCollectionOptions<TEntity, TId, never> & { readonly homeostatReceptor?: undefined }
    ): CNSHomeostatModelDefinition<TAxon, TCollections & Record<TName, TEntity>, TReceptors>;
    public collection<TName extends string, TEntity extends object, TId extends string | number, TKey extends TCNSHomeostatModelKey | []>(
        name: TName,
        options: TCNSHomeostatModelCollectionOptions<TEntity, TId, TKey>
    ): CNSHomeostatModelDefinition<TAxon, TCollections & Record<TName, TEntity>, TReceptors & Record<TName, TCNSHomeostatModelCollectionHomeostasis<TKey, TId>>> {
        const homeostatReceptorOption = options.homeostatReceptor;
        if (homeostatReceptorOption instanceof CNSHomeostatReceptor) {
            return this.collectionOf(name, options, { homeostatReceptor: homeostatReceptorOption, keyOf: (id: TId): [TId] => [id] });
        }
        return this.collectionOf(name, options, homeostatReceptorOption);
    }

    private collectionOf<TName extends string, TEntity extends object, TId extends string | number, TKey extends TCNSHomeostatModelKey>(
        name: TName,
        options: Omit<TCNSHomeostatModelCollectionOptions<TEntity, TId, never>, 'homeostatReceptor'>,
        collectionHomeostatReceptor: TCNSHomeostatModelCollectionReceptor<TEntity, TId, TKey> | undefined
    ): CNSHomeostatModelDefinition<TAxon, TCollections & Record<TName, TEntity>, TReceptors & Record<TName, TCNSHomeostatModelCollectionHomeostasis<never, never>>> {
        if (collectionHomeostatReceptor !== undefined && CNS_HOMEOSTAT_MODEL_MEMBER_NAMES.includes(name)) {
            throw new Error(`CNSHomeostatModelDefinition: a collection with a homeostatReceptor cannot be named "${name}"; the model has a member of that name`);
        }
        const idOf = options.idOf;
        const isNewer = options.isNewer;
        const draftCollection = <THandles extends ICNSHomeostatModelHandles>(draft: TCNSHomeostatModelDraft<TAxon, THandles>): void => {
            const collectionReceptiveDemand = collectionHomeostatReceptor === undefined ? undefined : draft.binding.createReceptiveDemand(
                draft.homeostatEnvironment,
                collectionHomeostatReceptor.homeostatReceptor,
                { selectKey: collectionHomeostatReceptor.keyOf, isOnlyEmptyEntryDemanded: true }
            );
            if (collectionReceptiveDemand !== undefined) {
                if (name in draft.homeostasis) throw new Error(`defineCNSHomeostatModel: the collection "${name}" and a receptor of the same model share a name; their homeostasis would collide`);
                draft.homeostasis[name] = collectionReceptiveDemand.homeostasis;
            }
            const receptiveDemand = collectionReceptiveDemand?.receptiveDemand;
            const entityCollection = draft.binding.createEntityCollection<TEntity>({
                idOf,
                isSameValue: options.isSameValue ?? isCNSHomeostatSameValue,
                receptiveDemand,
                keepAfterIdleMs: options.keepAfterIdleMs ?? 0,
            });
            const writeEntity = (entity: TEntity): 'inserted' | 'changed' | undefined => {
                const current = entityCollection.peekEntity(idOf(entity));
                if (current !== undefined && isNewer !== undefined && !isNewer(entity, current)) return undefined;
                if (!entityCollection.writeEntity(entity)) return undefined;
                return current === undefined ? 'inserted' : 'changed';
            };
            draft.collections[name] = entityCollection.handle;
            draft.draftCollectionByName.set(name, {
                writeEntity,
                idOf,
                createBucketCollection: (receptiveDemandOfBucket, keepAfterIdleMs) => draft.binding.createBucketCollection<TEntity>(entityCollection, receptiveDemandOfBucket, keepAfterIdleMs),
            });
            if (collectionHomeostatReceptor === undefined) return;
            if (collectionReceptiveDemand !== undefined) {
                draft.entityReaders[name] = {
                    collection: entityCollection.handle,
                    homeostasis: collectionReceptiveDemand.homeostasis,
                    keyOf: collectionHomeostatReceptor.keyOf,
                };
            }
            const collectionReceptor = collectionHomeostatReceptor.homeostatReceptor;
            draft.invalidations.push(() => draft.homeostatEnvironment.invalidateAll(collectionReceptor));
            draft.homeostatDendriteBuilder.dendrite({
                collateral: collectionHomeostatReceptor.homeostatReceptor.axon.homeostasisRestored,
                response: ({ data }) => { writeEntity(data); },
            });
        };
        return new CNSHomeostatModelDefinition<TAxon, TCollections & Record<TName, TEntity>, TReceptors>(
            this.axon,
            collectionHomeostatReceptor === undefined ? this.homeostatReceptors : [...this.homeostatReceptors, collectionHomeostatReceptor.homeostatReceptor],
            [...this.draftSteps, draftCollection]
        );
    }

    public homeostatReceptor<
        TName extends string,
        TKey extends TCNSHomeostatModelKey,
        TData,
        TSummary extends object = never,
        TBucketCollectionName extends keyof TCollections & string = never,
    >(
        name: TName,
        options: TCNSHomeostatModelReceptorOptions<TAxon, TCollections, TKey, TData, TSummary, TBucketCollectionName>
    ): CNSHomeostatModelDefinition<
        TAxon,
        TCollections,
        TReceptors & Record<TName, { readonly key: TKey; readonly summary: TSummary; readonly bucketCollectionName: TBucketCollectionName }>
    > {
        const { homeostatReceptor, bucketsOf, entitiesOf, summaryOf, afterWrite } = options;
        const keepAfterIdleMs = options.keepAfterIdleMs ?? 0;
        const draftHomeostatReceptor = <THandles extends ICNSHomeostatModelHandles>(draft: TCNSHomeostatModelDraft<TAxon, THandles>): void => {
            const homeostatEnvironment = draft.homeostatEnvironment;
            const receptiveDemand = draft.binding.createReceptiveDemand(
                homeostatEnvironment,
                homeostatReceptor,
                { selectKey: (key: TKey): TKey => key, isOnlyEmptyEntryDemanded: false }
            );
            draft.homeostasis[name] = receptiveDemand.homeostasis;
            draft.invalidations.push(() => homeostatEnvironment.invalidateAll(homeostatReceptor));
            const summaryCollection = summaryOf === undefined ? undefined : draft.binding.createSummaryCollection<TSummary>({
                isSameValue: options.isSameValue ?? isCNSHomeostatSameValue,
                receptiveDemand: receptiveDemand.receptiveDemand,
                keepAfterIdleMs,
            });
            if (summaryCollection !== undefined) draft.summaries[name] = summaryCollection.handle;
            const draftCollectionOf = (collectionName: string): TCNSHomeostatModelDraftCollection<THandles> => {
                const draftCollection = draft.draftCollectionByName.get(collectionName);
                if (draftCollection === undefined) throw new Error(`CNSHomeostatModelDefinition: the homeostat receptor "${name}" answered entities of "${collectionName}", which is not a collection of the model`);
                return draftCollection;
            };
            const bucketCollectionByName = new Map<string, TCNSHomeostatModelBucketCollection>();
            const bucketCollectionOf = (collectionName: string): TCNSHomeostatModelBucketCollection => {
                let bucketCollection = bucketCollectionByName.get(collectionName);
                if (bucketCollection === undefined) {
                    bucketCollection = draftCollectionOf(collectionName).createBucketCollection(receptiveDemand.receptiveDemand, keepAfterIdleMs);
                    bucketCollectionByName.set(collectionName, bucketCollection);
                }
                return bucketCollection;
            };
            if (bucketsOf !== undefined) {
                const buckets: Record<string, unknown> = {};
                for (const collectionName of draft.draftCollectionByName.keys()) {
                    Object.defineProperty(buckets, collectionName, { enumerable: true, get: () => bucketCollectionOf(collectionName).handle });
                }
                draft.buckets[name] = buckets;
            }
            draft.homeostatDendriteBuilder.dendrite({
                collateral: homeostatReceptor.axon.homeostasisRestored,
                response: ({ key, data }, axon) => homeostatEnvironment.homeostatEnvironmentOptions.runInTransaction(() => {
                    const insertedEntities: Record<string, object[]> = {};
                    const changedEntities: Record<string, object[]> = {};
                    let isEntityWritten = false;
                    let isBucketChanged = false;
                    for (const collectionName of draft.draftCollectionByName.keys()) {
                        insertedEntities[collectionName] = [];
                        changedEntities[collectionName] = [];
                    }
                    const writeEntities = (collectionName: string, entities: readonly object[]): void => {
                        const draftCollection = draftCollectionOf(collectionName);
                        const inserted = insertedEntities[collectionName] ?? [];
                        const changed = changedEntities[collectionName] ?? [];
                        for (const entity of entities) {
                            const entityWrite = draftCollection.writeEntity(entity);
                            if (entityWrite === 'inserted') inserted.push(entity);
                            else if (entityWrite === 'changed') changed.push(entity);
                            if (entityWrite !== undefined) isEntityWritten = true;
                        }
                        insertedEntities[collectionName] = inserted;
                        changedEntities[collectionName] = changed;
                    };
                    if (entitiesOf !== undefined) {
                        const entitiesByCollectionName = entitiesOf(data);
                        for (const collectionName in entitiesByCollectionName) {
                            const entities = entitiesByCollectionName[collectionName];
                            if (entities !== undefined) writeEntities(collectionName, entities);
                        }
                    }
                    if (bucketsOf !== undefined) {
                        const bucketEntitiesByCollectionName = bucketsOf(data);
                        for (const collectionName in bucketEntitiesByCollectionName) {
                            const entities = bucketEntitiesByCollectionName[collectionName];
                            writeEntities(collectionName, entities);
                            const draftCollection = draftCollectionOf(collectionName);
                            if (bucketCollectionOf(collectionName).writeBucket(key, entities.map(entity => draftCollection.idOf(entity)))) isBucketChanged = true;
                        }
                    }
                    const isSummaryChanged = summaryOf !== undefined && summaryCollection !== undefined && summaryCollection.writeSummary(key, summaryOf(data));
                    if (afterWrite === undefined || (!isEntityWritten && !isBucketChanged && !isSummaryChanged)) return undefined;
                    const insertedEntityRecord: Record<string, readonly object[]> = insertedEntities;
                    const changedEntityRecord: Record<string, readonly object[]> = changedEntities;
                    return afterWrite({
                        key,
                        data,
                        insertedEntities: insertedEntityRecord as { readonly [TCollectionName in keyof TCollections]: readonly TCollections[TCollectionName][] },
                        changedEntities: changedEntityRecord as { readonly [TCollectionName in keyof TCollections]: readonly TCollections[TCollectionName][] },
                        isBucketChanged,
                        isSummaryChanged,
                    }, axon);
                }),
            });
        };
        return new CNSHomeostatModelDefinition<
            TAxon,
            TCollections,
            TReceptors & Record<TName, { readonly key: TKey; readonly summary: TSummary; readonly bucketCollectionName: TBucketCollectionName }>
        >(this.axon, [...this.homeostatReceptors, homeostatReceptor], [...this.draftSteps, draftHomeostatReceptor]);
    }

    public createModel<THandles extends ICNSHomeostatModelHandles>(
        binding: ICNSHomeostatModelBinding<THandles>,
        homeostatEnvironment: THandles['homeostatEnvironment']
    ): { readonly homeostatDendrites: readonly unknown[]; createNeuron(): ReturnType<typeof neuron<TAxon>> } & Record<string, unknown> {
        const axon = this.axon;
        const draft: TCNSHomeostatModelDraft<TAxon, THandles> = {
            binding,
            homeostatEnvironment,
            homeostatDendriteBuilder: neuron(axon),
            draftCollectionByName: new Map(),
            collections: {},
            buckets: {},
            summaries: {},
            homeostasis: {},
            entityReaders: {},
            invalidations: [],
        };
        for (const draftStep of this.draftSteps) draftStep(draft);
        const homeostatDendrites = draft.homeostatDendriteBuilder.dendrites;
        return {
            ...draft.entityReaders,
            collections: draft.collections,
            buckets: draft.buckets,
            summaries: draft.summaries,
            homeostasis: draft.homeostasis,
            homeostatDendrites,
            createNeuron: () => neuron(axon).dendrite(homeostatDendrites),
            invalidate: async (): Promise<void> => {
                await Promise.all(draft.invalidations.map(invalidation => invalidation()));
            },
        };
    }
}
