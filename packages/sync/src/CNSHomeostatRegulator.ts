import type { TCNSHomeostatCNS } from './types/TCNSHomeostatCNS';
import type { TCNSSignal, ICNSCollateral, ICNSStimulation, TCNSStimulationOptions, TCNSStimulationResponse } from '@cnstra/types';
import type { CNSHomeostatReceptor } from './CNSHomeostatReceptor';
import { CNSHomeostatFiringContext } from './CNSHomeostatFiringContext';
import { CNSHomeostatRunningFiring } from './CNSHomeostatRunningFiring';
import type { ICNSHomeostatCorrectionRepository } from './interfaces/ICNSHomeostatCorrectionRepository';
import type { ICNSHomeostatFiringPolicy } from './interfaces/ICNSHomeostatFiringPolicy';
import type { ICNSHomeostatRefetchPolicy } from './interfaces/ICNSHomeostatRefetchPolicy';
import { ECNSHomeostatCorrectionStatus } from './types/ECNSHomeostatCorrectionStatus';
import type { TCNSHomeostasisQuery } from './types/TCNSHomeostasisQuery';
import type { TCNSHomeostasisState } from './types/TCNSHomeostasisState';
import type { TCNSHomeostatCorrectionState } from './types/TCNSHomeostatCorrectionState';
import type { TCNSHomeostatInvalidationWaiter } from './types/TCNSHomeostatInvalidationWaiter';
import type { TCNSHomeostatKeyState } from './types/TCNSHomeostatKeyState';
import type { TCNSHomeostatRegulatorOptions } from './types/TCNSHomeostatRegulatorOptions';
import type { TCNSHomeostatSource } from './types/TCNSHomeostatSource';
import { createCNSHomeostasisState } from './utils/createCNSHomeostasisState';
import { CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY } from './utils/CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY';
import type { TCNSHomeostatOutcomeStatus } from './types/TCNSHomeostatOutcomeStatus';

export class CNSHomeostatRegulator<TKey extends readonly unknown[], TData> {
    public readonly homeostatReceptor: CNSHomeostatReceptor<TKey, TData>;

    private readonly homeostatCorrectionRepository: ICNSHomeostatCorrectionRepository<readonly unknown[]>;

    private readonly cns: TCNSHomeostatCNS;

    private readonly homeostatFiringPolicy: ICNSHomeostatFiringPolicy;

    private readonly homeostatRefetchPolicy: ICNSHomeostatRefetchPolicy;

    private readonly stimulationOptions: TCNSStimulationOptions<TCNSStimulationResponse> | undefined;

    private readonly getNowMs: () => number;

    private readonly keyHashFn: (key: readonly unknown[]) => string;

    private readonly runUntracked: (run: () => void) => void;

    private readonly runInTransaction: <TResult>(run: () => TResult) => TResult;

    private readonly scheduleRefetchAt: (keyHash: string, refetchAtMs: number, refetch: () => void) => (() => void) | void;

    private readonly keyStateByKeyHash = new Map<string, TCNSHomeostatKeyState<TKey>>();

    private readonly homeostatRunningFirings = new Set<CNSHomeostatRunningFiring<TKey>>();

    private lastFiringNumber = 0;

    private isDisposed = false;

    public constructor(options: TCNSHomeostatRegulatorOptions<TKey, TData>) {
        this.homeostatReceptor = options.homeostatReceptor;
        this.cns = options.cns;
        this.homeostatCorrectionRepository = options.homeostatCorrectionRepository;
        this.homeostatFiringPolicy = options.homeostatFiringPolicy;
        this.homeostatRefetchPolicy = options.homeostatRefetchPolicy;
        this.stimulationOptions = options.stimulationOptions;
        this.getNowMs = options.getNowMs;
        this.keyHashFn = options.keyHashFn;
        this.runUntracked = options.runUntracked;
        this.runInTransaction = options.runInTransaction;
        this.scheduleRefetchAt = options.scheduleRefetchAt;
    }

    public createHomeostasisQuery(homeostatSourceKey?: TKey, homeostatSourceKeyHash?: string, isObserved = true): TCNSHomeostasisQuery<TKey, TData> {
        return {
            homeostasisState: undefined,
            homeostatSource: undefined,
            homeostatSourceKey,
            homeostatSourceKeyHash,
            homeostatRunningFiring: undefined,
            heldKeyHash: undefined,
            isObserved,
        };
    }

    public observe(homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>): void {
        homeostasisQuery.isObserved = true;
        const homeostatRunningFiring = homeostasisQuery.homeostatRunningFiring;
        if (homeostatRunningFiring !== undefined) this.startPendingFiring(homeostatRunningFiring);
    }

    public unobserve(homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>): void {
        homeostasisQuery.isObserved = false;
    }

    public requireTransduce(): (key: TKey, abortSignal: AbortSignal) => Promise<TData> {
        const transduce = this.homeostatReceptor.transduce;
        if (transduce === undefined) throw new Error(`CNSHomeostatReceptor ${this.homeostatReceptor.name} has no transduce for a query by key`);
        return transduce;
    }

    public createHomeostatSource(key: TKey): TCNSHomeostatSource<TKey, TData> {
        const transduce = this.requireTransduce();
        return { key, transduce: abortSignal => transduce(key, abortSignal) };
    }

    public homeostatSourceKeyHashOf(homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>, homeostatSource: TCNSHomeostatSource<TKey, TData>): string {
        const key = homeostatSource.key;
        const cachedKeyHash = homeostasisQuery.homeostatSourceKeyHash;
        if (cachedKeyHash !== undefined && homeostasisQuery.homeostatSourceKey === key) return cachedKeyHash;
        const keyHash = this.keyHashFn(key);
        homeostasisQuery.homeostatSourceKey = key;
        homeostasisQuery.homeostatSourceKeyHash = keyHash;
        return keyHash;
    }

    public createIdleHomeostasisState<TStateKey extends TKey | undefined>(key: TStateKey): TCNSHomeostasisState<TStateKey> {
        return createCNSHomeostasisState(key, ECNSHomeostatCorrectionStatus.Idle, 0, undefined, undefined);
    }

    public regulate(
        homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>,
        homeostatSource: TCNSHomeostatSource<TKey, TData>,
        homeostatCorrectionState: TCNSHomeostatCorrectionState<readonly unknown[]> | undefined
    ): TCNSHomeostasisState<TKey> {
        const previous = homeostasisQuery.homeostasisState;
        if (this.isDisposed) return previous ?? this.createIdleHomeostasisState(homeostatSource.key);
        if (previous === undefined || homeostasisQuery.homeostatSource !== homeostatSource) {
            const previousKeyHash = homeostasisQuery.heldKeyHash;
            const keyHash = this.homeostatSourceKeyHashOf(homeostasisQuery, homeostatSource);
            homeostasisQuery.homeostatSource = homeostatSource;
            if (previous === undefined || keyHash !== previousKeyHash) {
                const previousRunningFiring = homeostasisQuery.homeostatRunningFiring;
                if (keyHash !== previousKeyHash) {
                    this.holdKey(keyHash, homeostatSource.key);
                    homeostasisQuery.heldKeyHash = keyHash;
                }
                const homeostasisState = this.supersede(homeostasisQuery, homeostatSource, homeostatCorrectionState, previousRunningFiring);
                if (previousKeyHash !== undefined && previousKeyHash !== keyHash) this.unholdKey(previousKeyHash);
                return homeostasisState;
            }
            if (previous.status === ECNSHomeostatCorrectionStatus.Failed) {
                if (homeostatCorrectionState !== undefined && homeostatCorrectionState.status === ECNSHomeostatCorrectionStatus.Failed
                    && homeostatCorrectionState.firingNumber <= previous.firingNumber) {
                    const refetchAtMs = this.homeostatRefetchPolicy.refetchAtMs(homeostatCorrectionState);
                    if (refetchAtMs !== Infinity && this.getNowMs() < refetchAtMs) return previous;
                }
                return this.fireOrPause(homeostasisQuery, homeostatSource, homeostatCorrectionState, this.homeostatFiringPolicy.isFiringAllowed(), undefined);
            }
        }
        if (previous.status === ECNSHomeostatCorrectionStatus.Paused) {
            if (!this.homeostatFiringPolicy.isFiringAllowed()) return previous;
            return this.fireOrPause(homeostasisQuery, homeostatSource, homeostatCorrectionState, true, undefined);
        }
        if (previous.status === ECNSHomeostatCorrectionStatus.Firing) {
            const answeringHomeostatCorrectionState = this.answeringHomeostatCorrectionStateOf(homeostatCorrectionState, previous.firingNumber);
            if (answeringHomeostatCorrectionState !== undefined) return this.settle(homeostasisQuery, homeostatSource, answeringHomeostatCorrectionState);
            if (homeostatCorrectionState === undefined || homeostatCorrectionState.status !== ECNSHomeostatCorrectionStatus.Stale
                || homeostatCorrectionState.firingNumber < previous.firingNumber) return previous;
            return this.supersede(homeostasisQuery, homeostatSource, homeostatCorrectionState, homeostasisQuery.homeostatRunningFiring);
        }
        if (homeostatCorrectionState === undefined) return previous;
        if (homeostatCorrectionState.status === ECNSHomeostatCorrectionStatus.Stale) {
            const isInvalidated = this.heldKeyStateOf(this.heldKeyHashOf(homeostasisQuery)).invalidationWaiters !== undefined;
            if (!(isInvalidated ? this.homeostatFiringPolicy.isFiringAllowed() : this.homeostatFiringPolicy.isRefiringAllowed())) return previous;
            return this.fireOrPause(homeostasisQuery, homeostatSource, homeostatCorrectionState, true, undefined);
        }
        const answeringHomeostatCorrectionState = this.answeringHomeostatCorrectionStateOf(homeostatCorrectionState, previous.firingNumber + 1);
        if (answeringHomeostatCorrectionState !== undefined) return this.settle(homeostasisQuery, homeostatSource, answeringHomeostatCorrectionState);
        if (previous.status === ECNSHomeostatCorrectionStatus.Restored && homeostatCorrectionState.status === ECNSHomeostatCorrectionStatus.Failed
            && homeostatCorrectionState.firingNumber === previous.firingNumber) return this.settle(homeostasisQuery, homeostatSource, homeostatCorrectionState);
        if (homeostatCorrectionState.status !== ECNSHomeostatCorrectionStatus.Restored
            || this.getNowMs() < this.homeostatRefetchPolicy.refetchAtMs(homeostatCorrectionState)
            || !this.homeostatFiringPolicy.isRefiringAllowed()) return previous;
        return this.fireOrPause(homeostasisQuery, homeostatSource, homeostatCorrectionState, true, undefined);
    }

    public regulateSourceTracking(
        homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>,
        homeostatSource: TCNSHomeostatSource<TKey, TData> | undefined,
        homeostatCorrectionState: TCNSHomeostatCorrectionState<readonly unknown[]> | undefined
    ): TCNSHomeostasisState<TKey | undefined> {
        if (homeostatSource !== undefined) return this.regulate(homeostasisQuery, homeostatSource, homeostatCorrectionState);
        this.release(homeostasisQuery);
        return this.createIdleHomeostasisState(undefined);
    }

    public release(homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>): void {
        const homeostatRunningFiring = homeostasisQuery.homeostatRunningFiring;
        const heldKeyHash = homeostasisQuery.heldKeyHash;
        homeostasisQuery.homeostasisState = undefined;
        homeostasisQuery.homeostatSource = undefined;
        homeostasisQuery.homeostatRunningFiring = undefined;
        homeostasisQuery.heldKeyHash = undefined;
        if (homeostatRunningFiring !== undefined) this.leaveRunningFiring(homeostatRunningFiring, 'released');
        if (heldKeyHash !== undefined) this.unholdKey(heldKeyHash);
    }

    public invalidate(key: TKey): Promise<TCNSHomeostasisState<TKey> | undefined> {
        if (this.isDisposed) return Promise.resolve(undefined);
        const keyHash = this.keyHashFn(key);
        const keyState = this.keyStateByKeyHash.get(keyHash);
        const homeostatCorrectionState = this.homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash);
        if (keyState === undefined) {
            if (homeostatCorrectionState === undefined) return Promise.resolve(undefined);
            void this.stimulateDisturbed(key, keyHash, homeostatCorrectionState.firingNumber, homeostatCorrectionState.invalidationNumber + 1).waitUntilComplete();
            return Promise.resolve(undefined);
        }
        const invalidationNumber = (homeostatCorrectionState?.invalidationNumber ?? 0) + 1;
        let rejectInvalidated: (error: unknown) => void = () => undefined;
        const invalidated = new Promise<TCNSHomeostasisState<TKey> | undefined>((resolve, reject) => {
            rejectInvalidated = reject;
            (keyState.invalidationWaiters ??= []).push({ invalidationNumber, resolve, reject });
        });
        this.stimulateDisturbed(key, keyHash, homeostatCorrectionState?.firingNumber ?? 0, invalidationNumber).waitUntilComplete().then(undefined, rejectInvalidated);
        return invalidated;
    }

    public invalidateByKeyPrefix(keyPrefix: Readonly<Partial<TKey>>): Promise<(TCNSHomeostasisState<TKey> | undefined)[]> {
        if (this.isDisposed) return Promise.resolve([]);
        const keyPrefixLength = keyPrefix.length;
        const keyPrefixId = this.keyHashFn(keyPrefix);
        const keys: TKey[] = [];
        for (const keyState of this.keyStateByKeyHash.values()) {
            const key = keyState.key;
            if (key.length >= keyPrefixLength && this.keyHashFn(key.slice(0, keyPrefixLength)) === keyPrefixId) keys.push(key);
        }
        return Promise.all(keys.map(key => this.invalidate(key)));
    }

    public dispose(): void {
        this.isDisposed = true;
        for (const homeostatRunningFiring of this.homeostatRunningFirings) homeostatRunningFiring.abort('disposed');
        this.homeostatRunningFirings.clear();
        for (const [keyHash, keyState] of this.keyStateByKeyHash) this.releaseKeyState(keyHash, keyState);
    }

    private stimulateDisturbed(key: TKey, keyHash: string, firingNumber: number, invalidationNumber: number): Pick<ICNSStimulation<never>, 'waitUntilComplete'> {
        const signal = this.homeostatReceptor.axon.homeostasisDisturbed.createSignal({ key, firingNumber });
        return this.runInTransaction(() => this.cns.stimulate(signal, this.firingStimulationOptionsOf(keyHash, invalidationNumber)));
    }

    private firingStimulationOptionsOf(keyHash: string, invalidationNumber: number): TCNSStimulationOptions<TCNSStimulationResponse> {
        const homeostatFiringContext = new CNSHomeostatFiringContext(this.homeostatCorrectionRepository, keyHash, this.getNowMs(), invalidationNumber, this.getNowMs);
        return {
            ...this.stimulationOptions,
            stimulationContext: { ...this.stimulationOptions?.stimulationContext, [CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY]: homeostatFiringContext },
        };
    }

    private supersede(
        homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>,
        homeostatSource: TCNSHomeostatSource<TKey, TData>,
        homeostatCorrectionState: TCNSHomeostatCorrectionState<readonly unknown[]> | undefined,
        supersededRunningFiring: CNSHomeostatRunningFiring<TKey> | undefined
    ): TCNSHomeostasisState<TKey> {
        const homeostasisState = this.fireOrPause(
            homeostasisQuery, homeostatSource, homeostatCorrectionState, this.homeostatFiringPolicy.isFiringAllowed(), supersededRunningFiring
        );
        if (supersededRunningFiring !== undefined && supersededRunningFiring !== homeostasisQuery.homeostatRunningFiring) this.leaveRunningFiring(supersededRunningFiring, 'superseded');
        return homeostasisState;
    }

    private fireOrPause(
        homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>,
        homeostatSource: TCNSHomeostatSource<TKey, TData>,
        homeostatCorrectionState: TCNSHomeostatCorrectionState<readonly unknown[]> | undefined,
        isFiringAllowed: boolean,
        supersededRunningFiring: CNSHomeostatRunningFiring<TKey> | undefined
    ): TCNSHomeostasisState<TKey> {
        const keyHash = this.heldKeyHashOf(homeostasisQuery);
        const keyState = this.heldKeyStateOf(keyHash);
        const sharedRunningFiring = keyState.homeostatRunningFiring;
        const isSharedRunningFiringOvertaken = sharedRunningFiring !== undefined && homeostatCorrectionState !== undefined
            && homeostatCorrectionState.status === ECNSHomeostatCorrectionStatus.Stale && homeostatCorrectionState.firingNumber >= sharedRunningFiring.firingNumber;
        if (sharedRunningFiring !== undefined && sharedRunningFiring !== supersededRunningFiring && !isSharedRunningFiringOvertaken) {
            const answeringHomeostatCorrectionState = this.answeringHomeostatCorrectionStateOf(homeostatCorrectionState, sharedRunningFiring.firingNumber);
            if (answeringHomeostatCorrectionState !== undefined) {
                homeostasisQuery.homeostatRunningFiring = undefined;
                return this.settle(homeostasisQuery, homeostatSource, answeringHomeostatCorrectionState);
            }
            sharedRunningFiring.holderCount++;
            if (homeostasisQuery.isObserved) this.startPendingFiring(sharedRunningFiring);
            return this.assignHomeostasisState(homeostasisQuery, createCNSHomeostasisState(
                homeostatSource.key, ECNSHomeostatCorrectionStatus.Firing, sharedRunningFiring.firingNumber, homeostatCorrectionState?.error, sharedRunningFiring
            ), sharedRunningFiring);
        }
        if (homeostatCorrectionState !== undefined && homeostatCorrectionState.status === ECNSHomeostatCorrectionStatus.Restored) {
            const refetchAtMs = this.homeostatRefetchPolicy.refetchAtMs(homeostatCorrectionState);
            if (this.getNowMs() < refetchAtMs) {
                homeostasisQuery.homeostatRunningFiring = undefined;
                return this.settle(homeostasisQuery, homeostatSource, homeostatCorrectionState);
            }
        }
        if (!isFiringAllowed) {
            return this.assignHomeostasisState(homeostasisQuery, createCNSHomeostasisState(homeostatSource.key, ECNSHomeostatCorrectionStatus.Paused, 0, homeostatCorrectionState?.error, undefined), undefined);
        }
        if (homeostatCorrectionState !== undefined && homeostatCorrectionState.firingNumber > this.lastFiringNumber) {
            this.lastFiringNumber = homeostatCorrectionState.firingNumber;
        }
        const transduce = homeostatSource.transduce;
        const homeostatRunningFiring = new CNSHomeostatRunningFiring(homeostatSource.key, keyHash, ++this.lastFiringNumber);
        keyState.homeostatRunningFiring = homeostatRunningFiring;
        this.homeostatRunningFirings.add(homeostatRunningFiring);
        homeostatRunningFiring.pendingStart = () => this.fire(homeostatSource.key, keyHash, transduce, homeostatRunningFiring);
        if (homeostasisQuery.isObserved) this.startPendingFiring(homeostatRunningFiring);
        return this.assignHomeostasisState(homeostasisQuery, createCNSHomeostasisState(
            homeostatSource.key, ECNSHomeostatCorrectionStatus.Firing, homeostatRunningFiring.firingNumber, homeostatCorrectionState?.error, homeostatRunningFiring
        ), homeostatRunningFiring);
    }

    private settle(
        homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>,
        homeostatSource: TCNSHomeostatSource<TKey, TData>,
        homeostatCorrectionState: TCNSHomeostatCorrectionState<readonly unknown[]>
    ): TCNSHomeostasisState<TKey> {
        const keyHash = this.heldKeyHashOf(homeostasisQuery);
        const homeostatRunningFiring = homeostasisQuery.homeostatRunningFiring;
        const homeostasisState = this.assignHomeostasisState(homeostasisQuery, createCNSHomeostasisState(
            homeostatSource.key, homeostatCorrectionState.status, homeostatCorrectionState.firingNumber, homeostatCorrectionState.error, undefined
        ), undefined);
        if (homeostatRunningFiring !== undefined) this.leaveRunningFiring(homeostatRunningFiring, 'released');
        this.scheduleRefetch(keyHash, this.heldKeyStateOf(keyHash), this.homeostatRefetchPolicy.refetchAtMs(homeostatCorrectionState));
        return homeostasisState;
    }

    private assignHomeostasisState(
        homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>,
        homeostasisState: TCNSHomeostasisState<TKey>,
        homeostatRunningFiring: CNSHomeostatRunningFiring<TKey> | undefined
    ): TCNSHomeostasisState<TKey> {
        homeostasisQuery.homeostasisState = homeostasisState;
        homeostasisQuery.homeostatRunningFiring = homeostatRunningFiring;
        return homeostasisState;
    }

    private heldKeyHashOf(homeostasisQuery: TCNSHomeostasisQuery<TKey, TData>): string {
        const heldKeyHash = homeostasisQuery.heldKeyHash;
        if (heldKeyHash === undefined) throw new Error(`CNSHomeostatRegulator ${this.homeostatReceptor.name}: the query holds no key`);
        return heldKeyHash;
    }

    private heldKeyStateOf(keyHash: string): TCNSHomeostatKeyState<TKey> {
        const keyState = this.keyStateByKeyHash.get(keyHash);
        if (keyState === undefined) throw new Error(`CNSHomeostatRegulator ${this.homeostatReceptor.name}: key ${keyHash} is not held`);
        return keyState;
    }

    private scheduleRefetch(keyHash: string, keyState: TCNSHomeostatKeyState<TKey>, refetchAtMs: number): void {
        if (keyState.refetchAtMs === refetchAtMs) return;
        this.cancelRefetch(keyState);
        if (refetchAtMs === Infinity) return;
        keyState.refetchAtMs = refetchAtMs;
        keyState.cancelRefetch = this.scheduleRefetchAt(keyHash, refetchAtMs, keyState.refetch);
    }

    private refetchIfDue(keyHash: string, keyState: TCNSHomeostatKeyState<TKey>): void {
        this.forgetRefetch(keyState);
        if (this.keyStateByKeyHash.get(keyHash) !== keyState) return;
        const homeostatCorrectionState = this.homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash);
        if (homeostatCorrectionState === undefined) return;
        const refetchAtMs = this.homeostatRefetchPolicy.refetchAtMs(homeostatCorrectionState);
        if (this.getNowMs() < refetchAtMs) {
            this.scheduleRefetch(keyHash, keyState, refetchAtMs);
            return;
        }
        void this.stimulateDisturbed(keyState.key, keyHash, homeostatCorrectionState.firingNumber, homeostatCorrectionState.invalidationNumber).waitUntilComplete();
    }

    private holdKey(keyHash: string, key: TKey): void {
        const keyState = this.keyStateByKeyHash.get(keyHash);
        if (keyState !== undefined) {
            keyState.holderCount++;
            return;
        }
        const heldKeyState: TCNSHomeostatKeyState<TKey> = {
            key,
            holderCount: 1,
            homeostatRunningFiring: undefined,
            invalidationWaiters: undefined,
            refetchAtMs: Infinity,
            cancelRefetch: undefined,
            refetch: () => this.refetchIfDue(keyHash, heldKeyState),
        };
        this.keyStateByKeyHash.set(keyHash, heldKeyState);
        this.homeostatCorrectionRepository.holdHomeostatCorrectionState(keyHash);
    }

    private unholdKey(keyHash: string): void {
        const keyState = this.keyStateByKeyHash.get(keyHash);
        if (keyState === undefined || --keyState.holderCount > 0) return;
        this.releaseKeyState(keyHash, keyState);
    }

    private releaseKeyState(keyHash: string, keyState: TCNSHomeostatKeyState<TKey>): void {
        this.keyStateByKeyHash.delete(keyHash);
        const invalidationWaiters = keyState.invalidationWaiters;
        keyState.invalidationWaiters = undefined;
        if (invalidationWaiters !== undefined) for (const invalidationWaiter of invalidationWaiters) invalidationWaiter.resolve(undefined);
        this.cancelRefetch(keyState);
        this.homeostatCorrectionRepository.unholdHomeostatCorrectionState(keyHash);
    }

    private settleInvalidationWaiters(homeostatRunningFiring: CNSHomeostatRunningFiring<TKey>): void {
        const keyState = this.keyStateByKeyHash.get(homeostatRunningFiring.keyHash);
        if (keyState === undefined) return;
        const invalidationWaiters = keyState.invalidationWaiters;
        if (invalidationWaiters === undefined) return;
        let waitingInvalidationWaiters: TCNSHomeostatInvalidationWaiter<TKey>[] | undefined;
        for (const invalidationWaiter of invalidationWaiters) {
            if (homeostatRunningFiring.invalidationNumber >= invalidationWaiter.invalidationNumber) {
                homeostatRunningFiring.waitUntilSettled().then(invalidationWaiter.resolve, invalidationWaiter.reject);
            } else {
                (waitingInvalidationWaiters ??= []).push(invalidationWaiter);
            }
        }
        keyState.invalidationWaiters = waitingInvalidationWaiters;
    }

    private cancelRefetch(keyState: TCNSHomeostatKeyState<TKey>): void {
        const cancelRefetch = this.forgetRefetch(keyState);
        if (typeof cancelRefetch === 'function') cancelRefetch();
    }

    private forgetRefetch(keyState: TCNSHomeostatKeyState<TKey>): (() => void) | void {
        const cancelRefetch = keyState.cancelRefetch;
        keyState.refetchAtMs = Infinity;
        keyState.cancelRefetch = undefined;
        return cancelRefetch;
    }

    private leaveRunningFiring(homeostatRunningFiring: CNSHomeostatRunningFiring<TKey>, abortCause: 'superseded' | 'released'): void {
        if (--homeostatRunningFiring.holderCount > 0) return;
        this.forgetRunningFiring(homeostatRunningFiring);
        if (homeostatRunningFiring.outcomeStatus !== undefined) return;
        this.homeostatRunningFirings.delete(homeostatRunningFiring);
        homeostatRunningFiring.abort(abortCause);
    }

    private forgetRunningFiring(homeostatRunningFiring: CNSHomeostatRunningFiring<TKey>): void {
        const keyState = this.keyStateByKeyHash.get(homeostatRunningFiring.keyHash);
        if (keyState !== undefined && keyState.homeostatRunningFiring === homeostatRunningFiring) keyState.homeostatRunningFiring = undefined;
    }

    private startPendingFiring(homeostatRunningFiring: CNSHomeostatRunningFiring<TKey>): void {
        const pendingStart = homeostatRunningFiring.pendingStart;
        if (pendingStart === undefined) return;
        homeostatRunningFiring.pendingStart = undefined;
        pendingStart();
    }

    private answeringHomeostatCorrectionStateOf(
        homeostatCorrectionState: TCNSHomeostatCorrectionState<readonly unknown[]> | undefined,
        firingNumber: number
    ): TCNSHomeostatCorrectionState<readonly unknown[]> | undefined {
        if (homeostatCorrectionState === undefined || homeostatCorrectionState.firingNumber < firingNumber) return undefined;
        const status = homeostatCorrectionState.status;
        return status === ECNSHomeostatCorrectionStatus.Restored || status === ECNSHomeostatCorrectionStatus.Failed ? homeostatCorrectionState : undefined;
    }

    private fire(
        key: TKey,
        keyHash: string,
        transduce: (abortSignal: AbortSignal) => Promise<TData>,
        homeostatRunningFiring: CNSHomeostatRunningFiring<TKey>
    ): void {
        this.runUntracked(() => {
            const abortSignal = homeostatRunningFiring.abortController.signal;
            if (abortSignal.aborted) return;
            const axon = this.homeostatReceptor.axon;
            const firingNumber = homeostatRunningFiring.firingNumber;
            const invalidationNumber = this.homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash)?.invalidationNumber ?? 0;
            homeostatRunningFiring.invalidationNumber = invalidationNumber;
            const stimulationOptions = this.firingStimulationOptionsOf(keyHash, invalidationNumber);
            const stimulateOutcome = (
                signal: TCNSSignal<ICNSCollateral<unknown>> | TCNSSignal<ICNSCollateral<unknown>>[],
                outcomeStatus: TCNSHomeostatOutcomeStatus | undefined,
                outcomeError: unknown
            ) => {
                this.homeostatRunningFirings.delete(homeostatRunningFiring);
                if (outcomeStatus !== undefined) homeostatRunningFiring.answer(outcomeStatus, outcomeError);
                let outcomeStimulation: Pick<ICNSStimulation<never>, 'waitUntilComplete'>;
                let isOutcomeStimulationThrown = false;
                let outcomeStimulationError: unknown;
                try {
                    outcomeStimulation = this.runInTransaction(() => this.cns.stimulate(signal, stimulationOptions));
                } catch (error) {
                    isOutcomeStimulationThrown = true;
                    outcomeStimulationError = error;
                    outcomeStimulation = { waitUntilComplete: () => Promise.reject(error) };
                }
                this.forgetRunningFiring(homeostatRunningFiring);
                if (outcomeStatus !== undefined) {
                    homeostatRunningFiring.complete(outcomeStimulation);
                    this.settleInvalidationWaiters(homeostatRunningFiring);
                }
                if (isOutcomeStimulationThrown) throw outcomeStimulationError;
                return outcomeStimulation;
            };
            const stimulateRestoredOrCancelled = (data: TData) => {
                const homeostatCorrectionState = this.homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash);
                if (homeostatCorrectionState !== undefined && homeostatCorrectionState.invalidationNumber > invalidationNumber) {
                    void stimulateOutcome(
                        [axon.homeostasisDisturbed.createSignal({ key, firingNumber }), axon.homeostasisCancelled.createSignal({ key, firingNumber })],
                        undefined,
                        undefined
                    ).waitUntilComplete();
                    return;
                }
                stimulateOutcome(axon.homeostasisRestored.createSignal({ key, firingNumber, data }), ECNSHomeostatCorrectionStatus.Restored, undefined)
                    .waitUntilComplete()
                    .then(undefined, error => this.runUntracked(() => {
                        if (!this.isDisposed) this.runInTransaction(() => this.cns.stimulate(axon.homeostasisFailed.createSignal({ key, firingNumber, error }), stimulationOptions));
                    }));
            };
            let transduced: Promise<TData>;
            try {
                this.runInTransaction(() => this.cns.stimulate(axon.homeostatFired.createSignal({ key, firingNumber }), stimulationOptions));
                transduced = transduce(abortSignal);
            } catch (error) {
                transduced = Promise.reject(error);
            }
            transduced.then(
                data => this.runUntracked(() => abortSignal.aborted
                    ? stimulateOutcome(axon.homeostasisCancelled.createSignal({ key, firingNumber }), undefined, undefined)
                    : stimulateRestoredOrCancelled(data)),
                error => this.runUntracked(() => abortSignal.aborted
                    ? stimulateOutcome(axon.homeostasisCancelled.createSignal({ key, firingNumber }), undefined, undefined)
                    : stimulateOutcome(axon.homeostasisFailed.createSignal({ key, firingNumber, error }), ECNSHomeostatCorrectionStatus.Failed, error))
            );
        });
    }
}
