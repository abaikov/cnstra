import { autorun, onBecomeObserved, onBecomeUnobserved, untracked } from 'mobx';
import type { IComputedValue, IObservableValue, IReactionDisposer } from 'mobx';
import type { TCNSHomeostasisState, TCNSHomeostatModelKey, TCNSHomeostatModelReceptiveDemandOptions } from '@cnstra/sync';

type TCNSMobXHomeostatReceptiveFieldKeyHold = {
    dispose: IReactionDisposer;
    entryCount: number;
};

export class CNSMobXHomeostatReceptiveField<TKey extends TCNSHomeostatModelKey, TEntryKey> {
    private readonly createHomeostasisComputed: (key: TKey) => IComputedValue<TCNSHomeostasisState<TKey>>;

    private readonly keyHashFn: (key: TKey) => string;

    private readonly runUntracked: (run: () => void) => void;

    private readonly selectKey: (entryKey: TEntryKey) => TKey;

    private readonly isOnlyEmptyEntryDemanded: boolean;

    private demandEntryKeyByEntry = new Map<IObservableValue<unknown>, TEntryKey>();

    private releasedKeyHashes: string[] = [];

    private isSettleScheduled = false;

    private isDisposed = false;

    private readonly keyHashByEntry = new Map<IObservableValue<unknown>, string>();

    private readonly keyHoldByKeyHash = new Map<string, TCNSMobXHomeostatReceptiveFieldKeyHold>();

    public constructor(
        createHomeostasisComputed: (key: TKey) => IComputedValue<TCNSHomeostasisState<TKey>>,
        keyHashFn: (key: TKey) => string,
        runUntracked: (run: () => void) => void,
        options: TCNSHomeostatModelReceptiveDemandOptions<TEntryKey, TKey>
    ) {
        this.createHomeostasisComputed = createHomeostasisComputed;
        this.keyHashFn = keyHashFn;
        this.runUntracked = runUntracked;
        this.selectKey = options.selectKey;
        this.isOnlyEmptyEntryDemanded = options.isOnlyEmptyEntryDemanded;
    }

    public createComputed(key: TKey): IComputedValue<TCNSHomeostasisState<TKey>> {
        return this.createHomeostasisComputed(key);
    }

    public observeEntry(entry: IObservableValue<unknown>, entryKey: TEntryKey): void {
        onBecomeObserved(entry, () => {
            if (this.isDisposed) return;
            this.demandEntryKeyByEntry.set(entry, entryKey);
            this.scheduleSettle();
        });
        onBecomeUnobserved(entry, () => this.release(entry));
    }

    public dispose(): void {
        this.isDisposed = true;
        this.demandEntryKeyByEntry.clear();
        this.releasedKeyHashes = [];
        this.keyHashByEntry.clear();
        for (const keyHold of this.keyHoldByKeyHash.values()) keyHold.dispose();
        this.keyHoldByKeyHash.clear();
    }

    private scheduleSettle(): void {
        if (this.isSettleScheduled) return;
        this.isSettleScheduled = true;
        this.runUntracked(() => this.settle());
    }

    private settle(): void {
        this.isSettleScheduled = false;
        const demandEntryKeyByEntry = this.demandEntryKeyByEntry;
        const releasedKeyHashes = this.releasedKeyHashes;
        this.demandEntryKeyByEntry = new Map();
        this.releasedKeyHashes = [];
        let firstError: unknown;
        let hasError = false;
        for (const [entry, entryKey] of demandEntryKeyByEntry) {
            try {
                this.hold(entry, entryKey);
            } catch (error) {
                if (!hasError) firstError = error;
                hasError = true;
            }
        }
        for (const keyHash of releasedKeyHashes) {
            const keyHold = this.keyHoldByKeyHash.get(keyHash);
            if (keyHold === undefined || keyHold.entryCount > 0) continue;
            this.keyHoldByKeyHash.delete(keyHash);
            keyHold.dispose();
        }
        if (hasError) throw firstError;
    }

    private hold(entry: IObservableValue<unknown>, entryKey: TEntryKey): void {
        if (this.keyHashByEntry.has(entry)) return;
        if (this.isOnlyEmptyEntryDemanded && untracked(() => entry.get()) !== undefined) return;
        const key = this.selectKey(entryKey);
        const keyHash = this.keyHashFn(key);
        const keyHold = this.keyHoldByKeyHash.get(keyHash);
        this.keyHashByEntry.set(entry, keyHash);
        if (keyHold !== undefined) {
            keyHold.entryCount++;
            return;
        }
        const homeostasisComputed = this.createHomeostasisComputed(key);
        this.keyHoldByKeyHash.set(keyHash, { dispose: autorun(() => { homeostasisComputed.get(); }), entryCount: 1 });
    }

    private release(entry: IObservableValue<unknown>): void {
        if (this.demandEntryKeyByEntry.delete(entry)) return;
        const keyHash = this.keyHashByEntry.get(entry);
        if (keyHash === undefined) return;
        this.keyHashByEntry.delete(entry);
        const keyHold = this.keyHoldByKeyHash.get(keyHash);
        if (keyHold === undefined || --keyHold.entryCount > 0) return;
        this.releasedKeyHashes.push(keyHash);
        this.scheduleSettle();
    }
}
