import { observable, runInAction } from 'mobx';
import type { ObservableMap } from 'mobx';
import type { ICNSHomeostatCorrectionRepository, TCNSHomeostatCorrectionState } from '@cnstra/sync';
import type { TCNSMobXHomeostatCorrectionRepositoryOptions } from './types/TCNSMobXHomeostatCorrectionRepositoryOptions';
import { scheduleCNSMobXHomeostatRelease } from './utils/scheduleCNSMobXHomeostatRelease';

export class CNSMobXHomeostatCorrectionRepository<TKey extends readonly unknown[]> implements ICNSHomeostatCorrectionRepository<TKey> {
    private readonly homeostatCorrectionStateByKeyHash: ObservableMap<string, TCNSHomeostatCorrectionState<TKey>> = observable.map({}, { deep: false });

    private readonly holderCountByKeyHash = new Map<string, number>();

    private readonly cancelDeleteByKeyHash = new Map<string, () => void>();

    private readonly keepAfterUnholdMs: number;

    public constructor(options: TCNSMobXHomeostatCorrectionRepositoryOptions = {}) {
        this.keepAfterUnholdMs = options.keepAfterUnholdMs ?? 0;
    }

    public peekHomeostatCorrectionState(keyHash: string): TCNSHomeostatCorrectionState<TKey> | undefined {
        return this.homeostatCorrectionStateByKeyHash.get(keyHash);
    }

    public writeHomeostatCorrectionState(keyHash: string, homeostatCorrectionState: TCNSHomeostatCorrectionState<TKey>): void {
        runInAction(() => this.homeostatCorrectionStateByKeyHash.set(keyHash, homeostatCorrectionState));
        if (!this.holderCountByKeyHash.has(keyHash) && !this.cancelDeleteByKeyHash.has(keyHash)) this.scheduleDelete(keyHash);
    }

    public holdHomeostatCorrectionState(keyHash: string): void {
        this.holderCountByKeyHash.set(keyHash, (this.holderCountByKeyHash.get(keyHash) ?? 0) + 1);
        const cancelDelete = this.cancelDeleteByKeyHash.get(keyHash);
        if (cancelDelete === undefined) return;
        this.cancelDeleteByKeyHash.delete(keyHash);
        cancelDelete();
    }

    public unholdHomeostatCorrectionState(keyHash: string): void {
        const holderCount = (this.holderCountByKeyHash.get(keyHash) ?? 1) - 1;
        if (holderCount > 0) {
            this.holderCountByKeyHash.set(keyHash, holderCount);
            return;
        }
        this.holderCountByKeyHash.delete(keyHash);
        this.scheduleDelete(keyHash);
    }

    private scheduleDelete(keyHash: string): void {
        this.cancelDeleteByKeyHash.get(keyHash)?.();
        this.cancelDeleteByKeyHash.set(keyHash, scheduleCNSMobXHomeostatRelease(this.keepAfterUnholdMs, () => {
            this.cancelDeleteByKeyHash.delete(keyHash);
            if (!this.holderCountByKeyHash.has(keyHash)) runInAction(() => this.homeostatCorrectionStateByKeyHash.delete(keyHash));
        }));
    }
}
