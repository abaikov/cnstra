import { createOIMEntitySlotCollectionStoreAggregate, createOIMReplacingEntityWriter, OIMSlotAfterIdleReleasePolicy } from '@oimdb/core';
import type { IOIMSlotSubscriptionListener, OIMDB, OIMEntitySlotCollectionStoreAggregate, TOIMEntitySlot, TOIMStoreKey } from '@oimdb/core';
import type {
    CNSHomeostatForwardingCNS,
    CNSHomeostatReceptor,
    ICNSHomeostatModelBinding,
    TCNSHomeostatModelBucketCollection,
    TCNSHomeostatModelEntityCollection,
    TCNSHomeostatModelEntityCollectionOptions,
    TCNSHomeostatModelKey,
    TCNSHomeostatModelReceptiveDemand,
    TCNSHomeostatModelReceptiveDemandOptions,
    TCNSHomeostatModelSummaryCollection,
    TCNSHomeostatModelSummaryCollectionOptions,
} from '@cnstra/sync';
import type { CNSOIMDBHomeostatEnvironment } from './CNSOIMDBHomeostatEnvironment';
import type { ICNSOIMDBHomeostatModelHandles } from './interfaces/ICNSOIMDBHomeostatModelHandles';
import type { TCNSOIMDBHomeostatEnvironmentFactoryOptions } from './types/TCNSOIMDBHomeostatEnvironmentFactoryOptions';
import { createCNSOIMDBHomeostatBucketCollection } from './utils/createCNSOIMDBHomeostatBucketCollection';
import { createCNSOIMDBHomeostatEnvironment } from './utils/createCNSOIMDBHomeostatEnvironment';
import { createCNSOIMDBHomeostatSummaryCollection } from './utils/createCNSOIMDBHomeostatSummaryCollection';

export class CNSOIMDBHomeostatModelBinding implements ICNSHomeostatModelBinding<ICNSOIMDBHomeostatModelHandles> {
    private readonly db: OIMDB;

    private readonly homeostatEnvironmentOptions: Omit<TCNSOIMDBHomeostatEnvironmentFactoryOptions, 'db' | 'cns'>;

    public constructor(db: OIMDB, homeostatEnvironmentOptions: Omit<TCNSOIMDBHomeostatEnvironmentFactoryOptions, 'db' | 'cns'> = {}) {
        this.db = db;
        this.homeostatEnvironmentOptions = homeostatEnvironmentOptions;
    }

    public createEnvironment(cns: CNSHomeostatForwardingCNS): CNSOIMDBHomeostatEnvironment {
        const db = this.db;
        cns.addDrainListener(() => db.flush());
        return createCNSOIMDBHomeostatEnvironment({ ...this.homeostatEnvironmentOptions, db, cns });
    }

    public createReceptiveDemand<TKey extends TCNSHomeostatModelKey, TData, TEntryKey extends NonNullable<unknown>>(
        homeostatEnvironment: CNSOIMDBHomeostatEnvironment,
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: TCNSHomeostatModelReceptiveDemandOptions<TEntryKey, TKey>
    ): TCNSHomeostatModelReceptiveDemand<IOIMSlotSubscriptionListener> {
        const homeostatReceptiveField = homeostatEnvironment.createReceptiveField<TKey, TData, TEntryKey, TOIMEntitySlot<object, TEntryKey>>(homeostatReceptor, {
            selectKey: options.selectKey,
            isSlotDemanded: options.isOnlyEmptyEntryDemanded ? entitySlot => entitySlot.entity === undefined : undefined,
        });
        return {
            receptiveDemand: homeostatReceptiveField.slotSubscriptionListener,
            homeostasis: homeostatReceptiveField.homeostasisComputedStoreAggregate,
        };
    }

    public createEntityCollection<TEntity extends object>(
        options: TCNSHomeostatModelEntityCollectionOptions<TEntity, IOIMSlotSubscriptionListener>
    ): TCNSHomeostatModelEntityCollection<TEntity, OIMEntitySlotCollectionStoreAggregate<object & TEntity>> {
        const entityCollection = createOIMEntitySlotCollectionStoreAggregate<object & TEntity>(this.db, {
            entityWriter: createOIMReplacingEntityWriter({ sameValueGuard: options.isSameValue }),
            slotSubscriptionListener: options.receptiveDemand,
            slotReleasePolicy: new OIMSlotAfterIdleReleasePolicy({ keepAfterIdleMs: options.keepAfterIdleMs }),
        });
        return {
            handle: entityCollection,
            peekEntity: id => entityCollection.peekSlotByKey(id)?.entity,
            writeEntity: entity => {
                const changedEntitySlots: TOIMEntitySlot<object & TEntity, TOIMStoreKey>[] = [];
                entityCollection.writeSlotContentByKey(options.idOf(entity), entity, changedEntitySlots);
                return changedEntitySlots.length > 0;
            },
        };
    }

    public createBucketCollection<TEntity extends object>(
        entityCollection: TCNSHomeostatModelEntityCollection<TEntity, OIMEntitySlotCollectionStoreAggregate<object & TEntity>>,
        receptiveDemand: IOIMSlotSubscriptionListener,
        keepAfterIdleMs: number
    ): TCNSHomeostatModelBucketCollection {
        const bucketCollection = createCNSOIMDBHomeostatBucketCollection<object & TEntity>(
            this.db,
            receptiveDemand,
            new OIMSlotAfterIdleReleasePolicy({ keepAfterIdleMs })
        );
        const entities = entityCollection.handle;
        return {
            handle: bucketCollection,
            writeBucket: (key, ids) => {
                const changedBucketSlots: ReturnType<typeof bucketCollection.writeSlotContentByKey>[] = [];
                bucketCollection.writeSlotContentByKey(key, ids.map(id => entities.getSlotByKey(id)), changedBucketSlots);
                return changedBucketSlots.length > 0;
            },
        };
    }

    public createSummaryCollection<TSummary extends object>(
        options: TCNSHomeostatModelSummaryCollectionOptions<IOIMSlotSubscriptionListener>
    ): TCNSHomeostatModelSummaryCollection<TSummary> {
        const summaryCollection = createCNSOIMDBHomeostatSummaryCollection<TSummary>(
            this.db,
            options.isSameValue,
            options.receptiveDemand,
            new OIMSlotAfterIdleReleasePolicy({ keepAfterIdleMs: options.keepAfterIdleMs })
        );
        return {
            handle: summaryCollection,
            writeSummary: (key, value) => {
                const changedSummarySlots: ReturnType<typeof summaryCollection.writeSlotContentByKey>[] = [];
                summaryCollection.writeSlotContentByKey(key, value, changedSummarySlots);
                return changedSummarySlots.length > 0;
            },
        };
    }
}
