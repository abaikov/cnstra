import {
    createOIMComputedService,
    createOIMSingleSourceTrackingComputedService,
    isOIMSlotReleased,
    OIMScalarKeyTreeWalk,
    OIMSlotTreeStoreService,
} from '@oimdb/core';
import type {
    OIMComputedService,
    OIMDB,
    OIMSingleSourceTrackingComputedService,
    TOIMComputedSlot,
    TOIMKeyedSlot,
    TOIMSlot,
    TOIMSlotStoreTree,
    TOIMStoreSlot,
} from '@oimdb/core';
import { CNSHomeostatEnvironment } from '@cnstra/sync';
import type { CNSHomeostatReceptor, TCNSHomeostasisState, TCNSHomeostatSource } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatCorrectionRepository } from './interfaces/ICNSOIMDBHomeostatCorrectionRepository';
import type { ICNSOIMDBHomeostatFiringPolicy } from './interfaces/ICNSOIMDBHomeostatFiringPolicy';
import type { TCNSOIMDBHomeostatEnvironmentOptions } from './types/TCNSOIMDBHomeostatEnvironmentOptions';
import type { TCNSOIMDBHomeostasisSourceTrackingComputedOptions } from './types/TCNSOIMDBHomeostasisSourceTrackingComputedOptions';
import type { TCNSOIMDBHomeostasisComputedQuery } from './types/TCNSOIMDBHomeostasisComputedQuery';
import type { TCNSOIMDBHomeostasisSourceTrackingComputedQuery } from './types/TCNSOIMDBHomeostasisSourceTrackingComputedQuery';
import type { TCNSOIMDBHomeostatKey } from './types/TCNSOIMDBHomeostatKey';
import type { TCNSOIMDBHomeostatReceptiveFieldOptions } from './types/TCNSOIMDBHomeostatReceptiveFieldOptions';
import { CNSOIMDBHomeostatReceptiveField } from './CNSOIMDBHomeostatReceptiveField';
import type { TCNSOIMDBHomeostasisComputedStoreAggregate } from './types/TCNSOIMDBHomeostasisComputedStoreAggregate';
import type { TCNSOIMDBHomeostasisSourceTrackingComputedStoreAggregate } from './types/TCNSOIMDBHomeostasisSourceTrackingComputedStoreAggregate';
import { rememberCNSHomeostasisSlotQueryValue } from './utils/rememberCNSHomeostasisSlotQueryValue';
import { releaseCNSHomeostasisSlotQueryValue } from './utils/releaseCNSHomeostasisSlotQueryValue';

export class CNSOIMDBHomeostatEnvironment extends CNSHomeostatEnvironment<ICNSOIMDBHomeostatFiringPolicy, ICNSOIMDBHomeostatCorrectionRepository> {
    public readonly db: OIMDB;

    private areSourceSlotsHeld = true;

    private readonly homeostatReceptiveFields: Pick<CNSOIMDBHomeostatReceptiveField<TCNSOIMDBHomeostatKey, {}>, 'dispose'>[] = [];

    public constructor(options: TCNSOIMDBHomeostatEnvironmentOptions) {
        super(options);
        this.db = options.db;
        for (const sourceSlot of options.homeostatFiringPolicy.sourceSlots) sourceSlot.holdSlot();
    }

    public override dispose(): void {
        super.dispose();
        if (this.areSourceSlotsHeld) for (const sourceSlot of this.homeostatEnvironmentOptions.homeostatFiringPolicy.sourceSlots) sourceSlot.unholdSlot();
        this.areSourceSlotsHeld = false;
        for (const homeostatReceptiveField of this.homeostatReceptiveFields) homeostatReceptiveField.dispose();
        this.homeostatReceptiveFields.length = 0;
    }

    public createComputedStoreAggregate<TKey extends TCNSOIMDBHomeostatKey, TData>(homeostatReceptor: CNSHomeostatReceptor<TKey, TData>): TCNSOIMDBHomeostasisComputedStoreAggregate<TKey> {
        const computedService = this.createComputedService(homeostatReceptor);
        return computedService.createStoreAggregate(computedService.createStoreSlot(this.db));
    }

    public createReceptiveField<TKey extends TCNSOIMDBHomeostatKey, TData, TSlotKey extends {}, TSlot extends TOIMKeyedSlot<TSlotKey> = TOIMKeyedSlot<TSlotKey>>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: TCNSOIMDBHomeostatReceptiveFieldOptions<TKey, TSlotKey, TSlot>
    ): CNSOIMDBHomeostatReceptiveField<TKey, TSlotKey, TSlot> {
        const homeostatReceptiveField = new CNSOIMDBHomeostatReceptiveField(
            this.db,
            this.createComputedStoreAggregate(homeostatReceptor),
            this.homeostatEnvironmentOptions.keyHashFn,
            this.homeostatEnvironmentOptions.runUntracked,
            options
        );
        this.homeostatReceptiveFields.push(homeostatReceptiveField);
        return homeostatReceptiveField;
    }

    public createSourceTrackingComputedStoreAggregate<TKey extends TCNSOIMDBHomeostatKey, TData>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: NoInfer<TCNSOIMDBHomeostasisSourceTrackingComputedOptions<TKey, TData>>
    ): TCNSOIMDBHomeostasisSourceTrackingComputedStoreAggregate<TKey> {
        const computedService = this.createSourceTrackingComputedService(homeostatReceptor, options);
        return computedService.createStoreAggregate(computedService.createStoreSlot(this.db));
    }

    private createComputedService<TKey extends TCNSOIMDBHomeostatKey, TData>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>
    ): OIMComputedService<TKey, TCNSHomeostasisState<TKey>, TOIMSlotStoreTree<TOIMComputedSlot<TCNSHomeostasisState<TKey>, TKey>, TCNSOIMDBHomeostatKey[number]>> {
        const homeostatRegulator = this.homeostatRegulatorOf(homeostatReceptor);
        homeostatRegulator.requireTransduce();
        const homeostatCorrectionRepository = this.homeostatCorrectionRepositoryOf(homeostatReceptor);
        const firingPolicySourceSlots = this.homeostatEnvironmentOptions.homeostatFiringPolicy.sourceSlots;
        const computedQueryByComputedSlot = new Map<TOIMSlot, TCNSOIMDBHomeostasisComputedQuery<TKey, TData>>();
        const computedQueryByHomeostasisState = new Map<TCNSHomeostasisState<TKey>, TCNSOIMDBHomeostasisComputedQuery<TKey, TData>>();
        const observedComputedSlots = new WeakSet<TOIMSlot>();
        return createOIMComputedService<TKey, TCNSHomeostasisState<TKey>, TOIMSlotStoreTree<TOIMComputedSlot<TCNSHomeostasisState<TKey>, TKey>, TCNSOIMDBHomeostatKey[number]>>({
            slotStoreService: new OIMSlotTreeStoreService<TCNSOIMDBHomeostatKey[number], TOIMComputedSlot<TCNSHomeostasisState<TKey>, TKey>>(OIMScalarKeyTreeWalk.INSTANCE),
            slotSubscriptionListener: {
                onSlotFirstSubscribed: computedSlot => {
                    observedComputedSlots.add(computedSlot);
                    const computedQuery = computedQueryByComputedSlot.get(computedSlot);
                    if (computedQuery !== undefined) homeostatRegulator.observe(computedQuery.homeostasisQuery);
                },
                onSlotLastUnsubscribed: computedSlot => {
                    observedComputedSlots.delete(computedSlot);
                    const computedQuery = computedQueryByComputedSlot.get(computedSlot);
                    if (computedQuery !== undefined) homeostatRegulator.unobserve(computedQuery.homeostasisQuery);
                },
            },
            createSources: computedSlot => ({
                sourceSlots: [homeostatCorrectionRepository.getHomeostatCorrectionSlot(this.homeostatEnvironmentOptions.keyHashFn(computedSlot.key)), ...firingPolicySourceSlots],
                sourceComputeds: [],
            }),
            derive: computedSlot => {
                let computedQuery = computedQueryByComputedSlot.get(computedSlot);
                if (computedQuery === undefined) {
                    if (isOIMSlotReleased(computedSlot)) return homeostatRegulator.createIdleHomeostasisState(computedSlot.key);
                    const homeostasisQuery = homeostatRegulator.createHomeostasisQuery(undefined, undefined, observedComputedSlots.has(computedSlot));
                    const homeostatSource = homeostatRegulator.createHomeostatSource(computedSlot.key);
                    computedQuery = {
                        homeostasisSlot: computedSlot,
                        homeostasisQuery,
                        homeostatSource,
                        homeostatCorrectionSlot: homeostatCorrectionRepository.getHomeostatCorrectionSlot(homeostatRegulator.homeostatSourceKeyHashOf(homeostasisQuery, homeostatSource)),
                    };
                    computedQueryByComputedSlot.set(computedSlot, computedQuery);
                }
                if (isOIMSlotReleased(computedSlot)) return computedQuery.homeostasisQuery.homeostasisState ?? homeostatRegulator.createIdleHomeostasisState(computedSlot.key);
                const homeostasisQuery = computedQuery.homeostasisQuery;
                return rememberCNSHomeostasisSlotQueryValue(
                    computedQueryByHomeostasisState, computedQuery, homeostasisQuery.homeostasisState,
                    homeostatRegulator.regulate(homeostasisQuery, computedQuery.homeostatSource, computedQuery.homeostatCorrectionSlot.entity)
                );
            },
            releaseValue: homeostasisState => {
                const computedQuery = releaseCNSHomeostasisSlotQueryValue(homeostatRegulator, computedQueryByHomeostasisState, homeostasisState);
                if (computedQuery !== undefined) computedQueryByComputedSlot.delete(computedQuery.homeostasisSlot);
            },
        });
    }

    private createSourceTrackingComputedService<TKey extends TCNSOIMDBHomeostatKey, TData>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: NoInfer<TCNSOIMDBHomeostasisSourceTrackingComputedOptions<TKey, TData>>
    ): OIMSingleSourceTrackingComputedService<TCNSHomeostasisState<TKey | undefined>> {
        const getHomeostatSource = options.getHomeostatSource;
        const db = this.db;
        const homeostatRegulator = this.homeostatRegulatorOf(homeostatReceptor);
        const homeostatCorrectionRepository = this.homeostatCorrectionRepositoryOf(homeostatReceptor);
        const firingPolicySourceSlots = this.homeostatEnvironmentOptions.homeostatFiringPolicy.sourceSlots;
        const trackedQueryByStoreSlot = new WeakMap<TOIMStoreSlot, TCNSOIMDBHomeostasisSourceTrackingComputedQuery<TKey, TData>>();
        const trackedQueryByHomeostasisState = new Map<TCNSHomeostasisState<TKey | undefined>, TCNSOIMDBHomeostasisSourceTrackingComputedQuery<TKey, TData>>();
        const observedStoreSlots = new WeakSet<TOIMStoreSlot>();
        const sourceService = createOIMSingleSourceTrackingComputedService<TCNSHomeostatSource<TKey, TData> | undefined>({
            derive: () => getHomeostatSource(),
        });
        return createOIMSingleSourceTrackingComputedService<TCNSHomeostasisState<TKey | undefined>>({
            slotSubscriptionListener: {
                onSlotFirstSubscribed: homeostasisSlot => {
                    observedStoreSlots.add(homeostasisSlot.storeSlot);
                    const trackedQuery = trackedQueryByStoreSlot.get(homeostasisSlot.storeSlot);
                    if (trackedQuery !== undefined) homeostatRegulator.observe(trackedQuery.homeostasisQuery);
                },
                onSlotLastUnsubscribed: homeostasisSlot => {
                    observedStoreSlots.delete(homeostasisSlot.storeSlot);
                    const trackedQuery = trackedQueryByStoreSlot.get(homeostasisSlot.storeSlot);
                    if (trackedQuery !== undefined) homeostatRegulator.unobserve(trackedQuery.homeostasisQuery);
                },
            },
            derive: homeostasisSlot => {
                let trackedQuery = trackedQueryByStoreSlot.get(homeostasisSlot.storeSlot);
                if (trackedQuery === undefined) {
                    if (isOIMSlotReleased(homeostasisSlot)) return homeostatRegulator.createIdleHomeostasisState(undefined);
                    trackedQuery = {
                        sourceStoreSlot: sourceService.createStoreSlot(db),
                        homeostasisQuery: homeostatRegulator.createHomeostasisQuery(undefined, undefined, observedStoreSlots.has(homeostasisSlot.storeSlot)),
                        homeostatCorrectionSlot: undefined,
                    };
                    trackedQueryByStoreSlot.set(homeostasisSlot.storeSlot, trackedQuery);
                }
                const homeostasisQuery = trackedQuery.homeostasisQuery;
                const previous = homeostasisQuery.homeostasisState;
                if (isOIMSlotReleased(homeostasisSlot)) return previous ?? homeostatRegulator.createIdleHomeostasisState(undefined);
                const homeostatSource = sourceService.getSingleSlot(trackedQuery.sourceStoreSlot).value;
                if (homeostatSource === undefined) {
                    return rememberCNSHomeostasisSlotQueryValue(
                        trackedQueryByHomeostasisState, trackedQuery, previous, homeostatRegulator.regulateSourceTracking(homeostasisQuery, undefined, undefined)
                    );
                }
                const keyHash = homeostatRegulator.homeostatSourceKeyHashOf(homeostasisQuery, homeostatSource);
                if (trackedQuery.homeostatCorrectionSlot === undefined || trackedQuery.homeostatCorrectionSlot.key !== keyHash
                    || isOIMSlotReleased(trackedQuery.homeostatCorrectionSlot)) {
                    trackedQuery.homeostatCorrectionSlot = homeostatCorrectionRepository.getHomeostatCorrectionSlot(keyHash);
                }
                const homeostatCorrectionState = trackedQuery.homeostatCorrectionSlot.entity;
                for (const firingPolicySourceSlot of firingPolicySourceSlots) void firingPolicySourceSlot.entity;
                return rememberCNSHomeostasisSlotQueryValue(
                    trackedQueryByHomeostasisState, trackedQuery, previous,
                    homeostatRegulator.regulateSourceTracking(homeostasisQuery, homeostatSource, homeostatCorrectionState)
                );
            },
            releaseValue: homeostasisState => { releaseCNSHomeostasisSlotQueryValue(homeostatRegulator, trackedQueryByHomeostasisState, homeostasisState); },
        });
    }
}
