import { OIMEffectService } from '@oimdb/core';
import type { IOIMSlotSubscriptionListener, OIMDB, TOIMColumnSlot, TOIMEffect, TOIMKeyedSlot, TOIMSlot } from '@oimdb/core';
import type { TCNSOIMDBHomeostasisComputedStoreAggregate } from './types/TCNSOIMDBHomeostasisComputedStoreAggregate';
import type { TCNSOIMDBHomeostatKey } from './types/TCNSOIMDBHomeostatKey';
import type { TCNSOIMDBHomeostatReceptiveFieldOptions } from './types/TCNSOIMDBHomeostatReceptiveFieldOptions';

type TCNSOIMDBHomeostatReceptiveFieldKeyHold = {
    effect: TOIMEffect;
    slotCount: number;
};

export class CNSOIMDBHomeostatReceptiveField<TKey extends TCNSOIMDBHomeostatKey, TSlotKey extends {}, TSlot extends TOIMKeyedSlot<TSlotKey> = TOIMKeyedSlot<TSlotKey>> {
    public readonly homeostasisComputedStoreAggregate: TCNSOIMDBHomeostasisComputedStoreAggregate<TKey>;

    public readonly slotSubscriptionListener: IOIMSlotSubscriptionListener;

    private readonly db: OIMDB;

    private readonly selectKey: (slotKey: TSlotKey) => TKey;

    private readonly isSlotDemanded: (slot: TSlot) => boolean;

    private readonly keyHashFn: (key: TKey) => string;

    private readonly runUntracked: (run: () => void) => void;

    private demandSlots: TOIMSlot[] = [];

    private releasedKeyHashes: string[] = [];

    private isSettleScheduled = false;

    private isDisposed = false;

    private readonly keyHashBySlot = new Map<TOIMSlot, string>();

    private readonly keyHoldByKeyHash = new Map<string, TCNSOIMDBHomeostatReceptiveFieldKeyHold>();

    public constructor(
        db: OIMDB,
        homeostasisComputedStoreAggregate: TCNSOIMDBHomeostasisComputedStoreAggregate<TKey>,
        keyHashFn: (key: TKey) => string,
        runUntracked: (run: () => void) => void,
        options: TCNSOIMDBHomeostatReceptiveFieldOptions<TKey, TSlotKey, TSlot>
    ) {
        this.db = db;
        this.homeostasisComputedStoreAggregate = homeostasisComputedStoreAggregate;
        this.keyHashFn = keyHashFn;
        this.runUntracked = runUntracked;
        this.selectKey = options.selectKey;
        this.isSlotDemanded = options.isSlotDemanded ?? (() => true);
        this.slotSubscriptionListener = {
            onSlotFirstSubscribed: slot => {
                if (this.isDisposed) return;
                this.demandSlots.push(slot);
                this.scheduleSettle();
            },
            onSlotLastUnsubscribed: slot => this.release(slot),
        };
    }

    public dispose(): void {
        this.isDisposed = true;
        this.demandSlots = [];
        this.releasedKeyHashes = [];
        this.keyHashBySlot.clear();
        for (const keyHold of this.keyHoldByKeyHash.values()) OIMEffectService.INSTANCE.disposeEffect(keyHold.effect);
        this.keyHoldByKeyHash.clear();
    }

    private scheduleSettle(): void {
        if (this.isSettleScheduled) return;
        this.isSettleScheduled = true;
        this.runUntracked(() => this.settle());
    }

    private settle(): void {
        this.isSettleScheduled = false;
        const demandSlots = this.demandSlots;
        const releasedKeyHashes = this.releasedKeyHashes;
        this.demandSlots = [];
        this.releasedKeyHashes = [];
        let firstError: unknown;
        let hasError = false;
        for (const slot of demandSlots) {
            try {
                this.hold(slot);
            } catch (error) {
                if (!hasError) firstError = error;
                hasError = true;
            }
        }
        for (const keyHash of releasedKeyHashes) {
            const keyHold = this.keyHoldByKeyHash.get(keyHash);
            if (keyHold === undefined || keyHold.slotCount > 0) continue;
            this.keyHoldByKeyHash.delete(keyHash);
            OIMEffectService.INSTANCE.disposeEffect(keyHold.effect);
        }
        if (hasError) throw firstError;
    }

    private hold(slot: TOIMSlot): void {
        if (slot.effects === undefined || slot.effects.length === 0 || this.keyHashBySlot.has(slot)) return;
        if (slot.storeSlot.channelSlot !== this.db.defaultChannelSlot) {
            throw new Error('CNSOIMDBHomeostatReceptiveField: a slot of another db is read; create a receptive field per environment');
        }
        const carrierSlot = ((slot as Partial<TOIMColumnSlot>).carrierSlot ?? slot) as TSlot;
        if (!this.isSlotDemanded(carrierSlot)) return;
        const key = this.selectKey(carrierSlot.key);
        const keyHash = this.keyHashFn(key);
        const keyHold = this.keyHoldByKeyHash.get(keyHash);
        if (keyHold !== undefined) {
            keyHold.slotCount++;
            this.keyHashBySlot.set(slot, keyHash);
            return;
        }
        const computedSlot = this.homeostasisComputedStoreAggregate.getSlotByKey(key);
        const effect = OIMEffectService.INSTANCE.createSourceTrackingEffect(this.db, () => { void computedSlot.value; });
        this.keyHoldByKeyHash.set(keyHash, { effect, slotCount: 1 });
        this.keyHashBySlot.set(slot, keyHash);
    }

    private release(slot: TOIMSlot): void {
        const keyHash = this.keyHashBySlot.get(slot);
        if (keyHash === undefined) return;
        this.keyHashBySlot.delete(slot);
        const keyHold = this.keyHoldByKeyHash.get(keyHash);
        if (keyHold === undefined || --keyHold.slotCount > 0) return;
        this.releasedKeyHashes.push(keyHash);
        this.scheduleSettle();
    }
}
