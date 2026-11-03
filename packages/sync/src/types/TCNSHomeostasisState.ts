import type { ICNSHomeostatRunningFiring } from '../interfaces/ICNSHomeostatRunningFiring';
import type { ECNSHomeostatCorrectionStatus } from './ECNSHomeostatCorrectionStatus';

export type TCNSHomeostasisState<TKey> = {
    key: TKey;
    status: ECNSHomeostatCorrectionStatus;
    firingNumber: number;
    error: unknown;
    homeostatRunningFiring: ICNSHomeostatRunningFiring<TKey> | undefined;
};
