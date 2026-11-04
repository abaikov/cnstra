import type { ICNSHomeostatRefetchPolicy, TCNSHomeostatCorrectionState } from '@cnstra/sync';
import type { TCNSStimulationDetailRefetchPolicyOptions } from './types/TCNSStimulationDetailRefetchPolicyOptions';
import { latestAttemptOf } from './latestAttemptOf';
import { SETTLED_STIMULATION_STATUSES } from './constants/SETTLED_STIMULATION_STATUSES';

export class CNSStimulationDetailRefetchPolicy implements ICNSHomeostatRefetchPolicy {
    public constructor(private readonly options: TCNSStimulationDetailRefetchPolicyOptions) {}

    public refetchAtMs(homeostatCorrectionState: TCNSHomeostatCorrectionState<unknown>): number {
        return homeostatCorrectionState.restoredAtMs !== undefined && this.isSettled(homeostatCorrectionState.key)
            ? Infinity
            : this.options.staleTimeRefetchPolicy.refetchAtMs(homeostatCorrectionState);
    }

    private isSettled(key: unknown): boolean {
        if (!Array.isArray(key)) return false;
        const [stimulationId] = key;
        if (typeof stimulationId !== 'string') return false;
        const latestAttempt = latestAttemptOf(this.options.stimulationDetailOf(stimulationId));
        return latestAttempt !== undefined && latestAttempt.completedAt !== null && SETTLED_STIMULATION_STATUSES.has(latestAttempt.status);
    }
}
