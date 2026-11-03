import type { ECNSJobFinalStatus } from './ECNSJobFinalStatus';
import type { TCNSJobState } from './TCNSJobState';

export type TCNSJobHistoryState<TPayload = unknown> = Omit<
    TCNSJobState<TPayload>,
    'seq' | 'runAfter' | 'lockedUntil' | 'wait'
> & {
    finishedAt: number;
    finalStatus: ECNSJobFinalStatus;
};
