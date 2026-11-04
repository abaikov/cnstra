import { hashCNSHomeostatKey } from '@cnstra/sync';
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
    TCNSHomeostatEnvironmentFactoryOptions,
    TCNSHomeostatFiringPolicyOptions,
    TCNSHomeostatModelSummaryCollectionOptions,
} from '@cnstra/sync';
import { CNSMobXHomeostatBucketCollection } from './CNSMobXHomeostatBucketCollection';
import { CNSMobXHomeostatEntryCollection } from './CNSMobXHomeostatEntryCollection';
import type { CNSMobXHomeostatEnvironment } from './CNSMobXHomeostatEnvironment';
import type { ICNSMobXHomeostatModelHandles } from './interfaces/ICNSMobXHomeostatModelHandles';
import { createCNSMobXHomeostatEnvironment } from './utils/createCNSMobXHomeostatEnvironment';

export class CNSMobXHomeostatModelBinding implements ICNSHomeostatModelBinding<ICNSMobXHomeostatModelHandles> {
    private readonly homeostatEnvironmentOptions: Omit<TCNSHomeostatEnvironmentFactoryOptions & TCNSHomeostatFiringPolicyOptions, 'cns'>;

    public constructor(homeostatEnvironmentOptions: Omit<TCNSHomeostatEnvironmentFactoryOptions & TCNSHomeostatFiringPolicyOptions, 'cns'> = {}) {
        this.homeostatEnvironmentOptions = homeostatEnvironmentOptions;
    }

    public createEnvironment(cns: CNSHomeostatForwardingCNS): CNSMobXHomeostatEnvironment {
        return createCNSMobXHomeostatEnvironment({ ...this.homeostatEnvironmentOptions, cns });
    }

    public createReceptiveDemand<TKey extends TCNSHomeostatModelKey, TData, TEntryKey extends NonNullable<unknown>>(
        homeostatEnvironment: CNSMobXHomeostatEnvironment,
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: TCNSHomeostatModelReceptiveDemandOptions<TEntryKey, TKey>
    ): TCNSHomeostatModelReceptiveDemand<ICNSMobXHomeostatModelHandles['receptiveDemand']> {
        const homeostatReceptiveField = homeostatEnvironment.createReceptiveField<TKey, TData, unknown>(homeostatReceptor, {
            selectKey: entryKey => options.selectKey(entryKey as TEntryKey),
            isOnlyEmptyEntryDemanded: options.isOnlyEmptyEntryDemanded,
        });
        return { receptiveDemand: homeostatReceptiveField, homeostasis: homeostatReceptiveField };
    }

    public createEntityCollection<TEntity extends object>(
        options: TCNSHomeostatModelEntityCollectionOptions<TEntity, ICNSMobXHomeostatModelHandles['receptiveDemand']>
    ): TCNSHomeostatModelEntityCollection<TEntity, CNSMobXHomeostatEntryCollection<string | number, object & TEntity>> {
        const entityCollection = new CNSMobXHomeostatEntryCollection<string | number, object & TEntity>({
            entryKeyHashFn: id => id,
            isSameValue: options.isSameValue,
            receptiveDemand: options.receptiveDemand,
            keepAfterIdleMs: options.keepAfterIdleMs,
        });
        return {
            handle: entityCollection,
            peekEntity: id => entityCollection.peekEntry(id),
            writeEntity: entity => entityCollection.writeEntry(options.idOf(entity), entity),
        };
    }

    public createBucketCollection<TEntity extends object>(
        entityCollection: TCNSHomeostatModelEntityCollection<TEntity, CNSMobXHomeostatEntryCollection<string | number, object & TEntity>>,
        receptiveDemand: ICNSMobXHomeostatModelHandles['receptiveDemand'],
        keepAfterIdleMs: number
    ): TCNSHomeostatModelBucketCollection {
        const bucketCollection = new CNSMobXHomeostatBucketCollection<object & TEntity>(entityCollection.handle, receptiveDemand, keepAfterIdleMs);
        return {
            handle: bucketCollection,
            writeBucket: (key, ids) => bucketCollection.writeBucket(key, ids),
        };
    }

    public createSummaryCollection<TSummary extends object>(
        options: TCNSHomeostatModelSummaryCollectionOptions<ICNSMobXHomeostatModelHandles['receptiveDemand']>
    ): TCNSHomeostatModelSummaryCollection<TSummary> {
        const summaryCollection = new CNSMobXHomeostatEntryCollection<TCNSHomeostatModelKey, TSummary>({
            entryKeyHashFn: hashCNSHomeostatKey,
            isSameValue: options.isSameValue,
            receptiveDemand: options.receptiveDemand,
            keepAfterIdleMs: options.keepAfterIdleMs,
        });
        return {
            handle: summaryCollection,
            writeSummary: (key, summary) => summaryCollection.writeEntry(key, summary),
        };
    }
}
