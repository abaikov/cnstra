import { observable, onBecomeObserved, onBecomeUnobserved, runInAction, untracked } from 'mobx';
import type { IObservableValue } from 'mobx';
import type { TCNSMobXHomeostatEntryCollectionOptions } from './types/TCNSMobXHomeostatEntryCollectionOptions';
import { scheduleCNSMobXHomeostatRelease } from './utils/scheduleCNSMobXHomeostatRelease';

type TCNSMobXHomeostatEntryHold<TEntry> = {
    readonly entryKeyHash: string | number;
    readonly entryBox: IObservableValue<TEntry | undefined>;
    isObserved: boolean;
    holdCount: number;
    isIdleWindowOver: boolean;
    cancelIdleWindow: (() => void) | undefined;
};

export class CNSMobXHomeostatEntryCollection<TEntryKey, TEntry extends object> {
    private readonly entryHoldByEntryKeyHash = new Map<string | number, TCNSMobXHomeostatEntryHold<TEntry>>();

    private readonly options: TCNSMobXHomeostatEntryCollectionOptions<TEntryKey, TEntry>;

    public constructor(options: TCNSMobXHomeostatEntryCollectionOptions<TEntryKey, TEntry>) {
        this.options = options;
    }

    public getEntry(entryKey: TEntryKey): TEntry | undefined {
        return this.idleEntryHoldOf(entryKey).entryBox.get();
    }

    public peekEntry(entryKey: TEntryKey): TEntry | undefined {
        const entryHold = this.entryHoldByEntryKeyHash.get(this.options.entryKeyHashFn(entryKey));
        return entryHold === undefined ? undefined : untracked(() => entryHold.entryBox.get());
    }

    public writeEntry(entryKey: TEntryKey, entry: TEntry): boolean {
        const entryKeyHash = this.options.entryKeyHashFn(entryKey);
        const heldEntryHold = this.entryHoldByEntryKeyHash.get(entryKeyHash);
        const previousEntry = heldEntryHold === undefined ? undefined : untracked(() => heldEntryHold.entryBox.get());
        if (this.options.isSameValue(previousEntry, entry)) return false;
        const entryHold = heldEntryHold ?? this.createEntryHold(entryKey, entryKeyHash);
        this.options.entryMemberHold?.holdMembers(entry);
        runInAction(() => entryHold.entryBox.set(entry));
        if (previousEntry !== undefined) this.options.entryMemberHold?.unholdMembers(previousEntry);
        else if (!entryHold.isObserved) this.openIdleWindow(entryHold);
        return true;
    }

    public holdEntry(entryKey: TEntryKey): void {
        this.idleEntryHoldOf(entryKey).holdCount++;
    }

    public unholdEntry(entryKey: TEntryKey): void {
        const entryHold = this.entryHoldByEntryKeyHash.get(this.options.entryKeyHashFn(entryKey));
        if (entryHold === undefined || --entryHold.holdCount > 0) return;
        this.releaseIfIdle(entryHold);
    }

    private idleEntryHoldOf(entryKey: TEntryKey): TCNSMobXHomeostatEntryHold<TEntry> {
        const entryKeyHash = this.options.entryKeyHashFn(entryKey);
        const heldEntryHold = this.entryHoldByEntryKeyHash.get(entryKeyHash);
        if (heldEntryHold !== undefined) return heldEntryHold;
        const entryHold = this.createEntryHold(entryKey, entryKeyHash);
        this.openIdleWindow(entryHold);
        return entryHold;
    }

    private createEntryHold(entryKey: TEntryKey, entryKeyHash: string | number): TCNSMobXHomeostatEntryHold<TEntry> {
        const entryBox = observable.box<TEntry | undefined>(undefined, { deep: false });
        const entryHold: TCNSMobXHomeostatEntryHold<TEntry> = {
            entryKeyHash,
            entryBox,
            isObserved: false,
            holdCount: 0,
            isIdleWindowOver: false,
            cancelIdleWindow: undefined,
        };
        this.entryHoldByEntryKeyHash.set(entryKeyHash, entryHold);
        onBecomeObserved(entryBox, () => {
            entryHold.isObserved = true;
            entryHold.isIdleWindowOver = false;
            entryHold.cancelIdleWindow?.();
            entryHold.cancelIdleWindow = undefined;
        });
        onBecomeUnobserved(entryBox, () => {
            entryHold.isObserved = false;
            this.openIdleWindow(entryHold);
        });
        this.options.receptiveDemand?.observeEntry(entryBox, entryKey);
        return entryHold;
    }

    private openIdleWindow(entryHold: TCNSMobXHomeostatEntryHold<TEntry>): void {
        entryHold.cancelIdleWindow?.();
        entryHold.isIdleWindowOver = false;
        entryHold.cancelIdleWindow = scheduleCNSMobXHomeostatRelease(this.options.keepAfterIdleMs, () => {
            entryHold.cancelIdleWindow = undefined;
            entryHold.isIdleWindowOver = true;
            this.releaseIfIdle(entryHold);
        });
    }

    private releaseIfIdle(entryHold: TCNSMobXHomeostatEntryHold<TEntry>): void {
        if (entryHold.isObserved || entryHold.holdCount > 0 || !entryHold.isIdleWindowOver) return;
        if (this.entryHoldByEntryKeyHash.get(entryHold.entryKeyHash) !== entryHold) return;
        this.entryHoldByEntryKeyHash.delete(entryHold.entryKeyHash);
        const entry = untracked(() => entryHold.entryBox.get());
        if (entry !== undefined) this.options.entryMemberHold?.unholdMembers(entry);
    }
}
