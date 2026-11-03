import type { ICNSHomeostatCorrectionRepository } from '@cnstra/sync';
import type { TCNSOIMDBHomeostatCorrectionSlot } from '../types/TCNSOIMDBHomeostatCorrectionSlot';
import type { TCNSOIMDBHomeostatKey } from '../types/TCNSOIMDBHomeostatKey';

export interface ICNSOIMDBHomeostatCorrectionRepository extends ICNSHomeostatCorrectionRepository<TCNSOIMDBHomeostatKey> {
    getHomeostatCorrectionSlot(keyHash: string): TCNSOIMDBHomeostatCorrectionSlot;
    peekHomeostatCorrectionSlot(keyHash: string): TCNSOIMDBHomeostatCorrectionSlot | undefined;
}
