import { computed, onBecomeUnobserved } from 'mobx';
import type { IComputedValue } from 'mobx';
import { CNSHomeostatEnvironment } from '@cnstra/sync';
import type {
    CNSHomeostatReceptor,
    ICNSHomeostatCorrectionRepository,
    ICNSHomeostatFiringPolicy,
    TCNSHomeostasisState,
    TCNSHomeostatModelKey,
    TCNSHomeostatModelReceptiveDemandOptions,
} from '@cnstra/sync';
import { CNSMobXHomeostatReceptiveField } from './CNSMobXHomeostatReceptiveField';
import type { TCNSMobXHomeostasisSourceTrackingComputedOptions } from './types/TCNSMobXHomeostasisSourceTrackingComputedOptions';

export class CNSMobXHomeostatEnvironment extends CNSHomeostatEnvironment<ICNSHomeostatFiringPolicy, ICNSHomeostatCorrectionRepository<readonly unknown[]>> {
    private readonly homeostasisComputedByKeyHashByReceptor = new Map<CNSHomeostatReceptor<never, unknown>, Map<string, unknown>>();

    private readonly homeostatReceptiveFields: Pick<CNSMobXHomeostatReceptiveField<TCNSHomeostatModelKey, unknown>, 'dispose'>[] = [];

    public override dispose(): void {
        super.dispose();
        for (const homeostatReceptiveField of this.homeostatReceptiveFields) homeostatReceptiveField.dispose();
        this.homeostatReceptiveFields.length = 0;
    }

    public createReceptiveField<TKey extends TCNSHomeostatModelKey, TData, TEntryKey>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: TCNSHomeostatModelReceptiveDemandOptions<TEntryKey, TKey>
    ): CNSMobXHomeostatReceptiveField<TKey, TEntryKey> {
        const homeostatReceptiveField = new CNSMobXHomeostatReceptiveField<TKey, TEntryKey>(
            key => this.createComputed(homeostatReceptor, key),
            this.homeostatEnvironmentOptions.keyHashFn,
            this.homeostatEnvironmentOptions.runUntracked,
            options
        );
        this.homeostatReceptiveFields.push(homeostatReceptiveField);
        return homeostatReceptiveField;
    }

    public createComputed<TKey extends readonly unknown[], TData>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        key: NoInfer<TKey>
    ): IComputedValue<TCNSHomeostasisState<TKey>> {
        const keyHash = this.homeostatEnvironmentOptions.keyHashFn(key);
        let homeostasisComputedByKeyHash = this.homeostasisComputedByKeyHashByReceptor.get(homeostatReceptor);
        if (homeostasisComputedByKeyHash === undefined) {
            homeostasisComputedByKeyHash = new Map();
            this.homeostasisComputedByKeyHashByReceptor.set(homeostatReceptor, homeostasisComputedByKeyHash);
        }
        const sharedHomeostasisComputed = homeostasisComputedByKeyHash.get(keyHash) as IComputedValue<TCNSHomeostasisState<TKey>> | undefined;
        if (sharedHomeostasisComputed !== undefined) return sharedHomeostasisComputed;
        const homeostatRegulator = this.homeostatRegulatorOf(homeostatReceptor);
        const homeostatCorrectionRepository = this.homeostatCorrectionRepositoryOf(homeostatReceptor);
        const homeostasisQuery = homeostatRegulator.createHomeostasisQuery(key, keyHash);
        const homeostatSource = homeostatRegulator.createHomeostatSource(key);
        const homeostatFiringPolicy = this.homeostatEnvironmentOptions.homeostatFiringPolicy;
        const homeostasisComputed = computed(() => {
            homeostatFiringPolicy.isRefiringAllowed();
            return homeostatRegulator.regulate(homeostasisQuery, homeostatSource, homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash));
        }, { requiresReaction: true });
        homeostasisComputedByKeyHash.set(keyHash, homeostasisComputed);
        onBecomeUnobserved(homeostasisComputed, () => {
            if (homeostasisComputedByKeyHash.get(keyHash) === homeostasisComputed) homeostasisComputedByKeyHash.delete(keyHash);
            homeostatRegulator.release(homeostasisQuery);
        });
        return homeostasisComputed;
    }

    public createSourceTrackingComputed<TKey extends readonly unknown[], TData>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, TData>,
        options: NoInfer<TCNSMobXHomeostasisSourceTrackingComputedOptions<TKey, TData>>
    ): IComputedValue<TCNSHomeostasisState<TKey | undefined>> {
        const homeostatRegulator = this.homeostatRegulatorOf(homeostatReceptor);
        const homeostatCorrectionRepository = this.homeostatCorrectionRepositoryOf(homeostatReceptor);
        const homeostasisQuery = homeostatRegulator.createHomeostasisQuery();
        const sourceComputed = computed(options.getHomeostatSource);
        const homeostatFiringPolicy = this.homeostatEnvironmentOptions.homeostatFiringPolicy;
        const homeostasisComputed = computed(() => {
            homeostatFiringPolicy.isRefiringAllowed();
            const homeostatSource = sourceComputed.get();
            const homeostatCorrectionState = homeostatSource === undefined
                ? undefined
                : homeostatCorrectionRepository.peekHomeostatCorrectionState(homeostatRegulator.homeostatSourceKeyHashOf(homeostasisQuery, homeostatSource));
            return homeostatRegulator.regulateSourceTracking(homeostasisQuery, homeostatSource, homeostatCorrectionState);
        }, { requiresReaction: true });
        onBecomeUnobserved(homeostasisComputed, () => homeostatRegulator.release(homeostasisQuery));
        return homeostasisComputed;
    }
}
