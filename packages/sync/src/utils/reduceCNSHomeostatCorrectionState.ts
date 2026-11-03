import { ECNSHomeostatCorrectionStatus } from '../types/ECNSHomeostatCorrectionStatus';
import type { TCNSHomeostatCorrectionState } from '../types/TCNSHomeostatCorrectionState';
import type { TCNSHomeostatOutcome } from '../types/TCNSHomeostatOutcome';

export function reduceCNSHomeostatCorrectionState<TKey>(
    homeostatCorrectionState: TCNSHomeostatCorrectionState<TKey> | undefined,
    homeostatOutcome: TCNSHomeostatOutcome<TKey>
): TCNSHomeostatCorrectionState<TKey> | undefined {
    if (homeostatCorrectionState !== undefined && homeostatCorrectionState.firingNumber > homeostatOutcome.firingNumber) return undefined;
    const isFailed = homeostatOutcome.status === ECNSHomeostatCorrectionStatus.Failed;
    const invalidationNumber = homeostatCorrectionState === undefined ? homeostatOutcome.invalidationNumber : homeostatCorrectionState.invalidationNumber;
    return {
        receptorName: homeostatOutcome.receptorName,
        key: homeostatOutcome.key,
        status: homeostatOutcome.invalidationNumber < invalidationNumber ? ECNSHomeostatCorrectionStatus.Stale : homeostatOutcome.status,
        firingNumber: homeostatOutcome.firingNumber,
        attempt: isFailed ? (homeostatCorrectionState?.failedAtMs !== undefined ? homeostatCorrectionState.attempt + 1 : 1) : 0,
        startedAtMs: homeostatOutcome.startedAtMs,
        restoredAtMs: isFailed ? undefined : homeostatOutcome.nowMs,
        failedAtMs: isFailed ? homeostatOutcome.nowMs : undefined,
        error: homeostatOutcome.error,
        invalidationNumber,
    };
}
