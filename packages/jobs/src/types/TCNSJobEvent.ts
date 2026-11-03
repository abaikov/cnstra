import type { ECNSJobEventName } from './ECNSJobEventName';
import type { TCNSJobAttempt } from './TCNSJobAttempt';

export type TCNSJobEvent = {
    name: ECNSJobEventName;
    jobId?: string;
    seq?: number;
    jobType?: string;
    jobGroup?: string;
    attempt?: TCNSJobAttempt;
    durationMs?: number;
    error?: unknown;
    count?: number;
};
