import type { TCNSHomeostatCorrectionState } from '../types/TCNSHomeostatCorrectionState';

export interface ICNSHomeostatCorrectionRepository<TKey> {
    peekHomeostatCorrectionState(keyHash: string): TCNSHomeostatCorrectionState<TKey> | undefined;
    writeHomeostatCorrectionState(keyHash: string, homeostatCorrectionState: TCNSHomeostatCorrectionState<TKey>): void;
    holdHomeostatCorrectionState(keyHash: string): void;
    unholdHomeostatCorrectionState(keyHash: string): void;
}
