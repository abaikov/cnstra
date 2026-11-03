import type { ICNSHomeostatRunningFiring } from '../interfaces/ICNSHomeostatRunningFiring';
import type { ECNSHomeostatCorrectionStatus } from '../types/ECNSHomeostatCorrectionStatus';
import type { TCNSHomeostasisState } from '../types/TCNSHomeostasisState';

export function createCNSHomeostasisState<TKey>(
    key: TKey,
    status: ECNSHomeostatCorrectionStatus,
    firingNumber: number,
    error: unknown,
    homeostatRunningFiring: ICNSHomeostatRunningFiring<TKey> | undefined
): TCNSHomeostasisState<TKey> {
    return { key, status, firingNumber, error, homeostatRunningFiring };
}
