import type { ECNSJobAbortReason } from './ECNSJobAbortReason';
import type { TCNSJobAttempt } from './TCNSJobAttempt';
import type { TCNSJobLogEntry } from './TCNSJobLogEntry';
import type { TCNSJobRunDirective } from './TCNSJobRunDirective';
import type { TCNSJobState } from './TCNSJobState';

export type TCNSJobRunningAttempt = {
    jobState: TCNSJobState;
    attempt: TCNSJobAttempt;
    controller: AbortController;
    attemptMeta: Record<string, unknown>;
    logSeq: number;
    logs: TCNSJobLogEntry[];
    abortReason?: ECNSJobAbortReason;
    timeoutError?: Error;
    directive?: TCNSJobRunDirective;
    settled: boolean;
    submitted: boolean;
};
