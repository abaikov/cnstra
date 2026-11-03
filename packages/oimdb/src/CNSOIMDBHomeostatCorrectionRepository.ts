import type { TCNSHomeostatCorrectionState } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatCorrectionRepository } from './interfaces/ICNSOIMDBHomeostatCorrectionRepository';
import type { TCNSOIMDBHomeostatCorrectionSlot } from './types/TCNSOIMDBHomeostatCorrectionSlot';
import type { TCNSOIMDBHomeostatCorrectionStoreSlot } from './types/TCNSOIMDBHomeostatCorrectionStoreSlot';
import type { TCNSOIMDBHomeostatKey } from './types/TCNSOIMDBHomeostatKey';

export class CNSOIMDBHomeostatCorrectionRepository implements ICNSOIMDBHomeostatCorrectionRepository {
    public readonly homeostatCorrectionStoreSlot: TCNSOIMDBHomeostatCorrectionStoreSlot;

    public constructor(homeostatCorrectionStoreSlot: TCNSOIMDBHomeostatCorrectionStoreSlot) {
        this.homeostatCorrectionStoreSlot = homeostatCorrectionStoreSlot;
    }

    public getHomeostatCorrectionSlot(keyHash: string): TCNSOIMDBHomeostatCorrectionSlot {
        return this.homeostatCorrectionStoreSlot.slotService.getSlotByKey(this.homeostatCorrectionStoreSlot, keyHash);
    }

    public peekHomeostatCorrectionSlot(keyHash: string): TCNSOIMDBHomeostatCorrectionSlot | undefined {
        return this.homeostatCorrectionStoreSlot.slotService.peekSlotByKey(this.homeostatCorrectionStoreSlot, keyHash);
    }

    public peekHomeostatCorrectionState(keyHash: string): TCNSHomeostatCorrectionState<TCNSOIMDBHomeostatKey> | undefined {
        return this.peekHomeostatCorrectionSlot(keyHash)?.entity;
    }

    public writeHomeostatCorrectionState(keyHash: string, homeostatCorrectionState: TCNSHomeostatCorrectionState<TCNSOIMDBHomeostatKey>): void {
        this.homeostatCorrectionStoreSlot.slotService.writeSlotContentByKey(this.homeostatCorrectionStoreSlot, keyHash, homeostatCorrectionState);
    }

    public holdHomeostatCorrectionState(): void {
        return;
    }

    public unholdHomeostatCorrectionState(): void {
        return;
    }
}
