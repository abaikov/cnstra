import type { ECNSJobWait } from './ECNSJobWait';
import type { TCNSJobAttempt } from './TCNSJobAttempt';
import type { TCNSJobRetry } from './TCNSJobRetry';

export type TCNSJobState<TPayload = unknown> = {
    jobId: string;
    seq: number;
    jobType: string;
    payload: TPayload;
    meta?: Record<string, unknown>;
    retry?: TCNSJobRetry;
    jobKey?: string;
    jobGroup?: string;
    priority: number;
    runAfter: number;
    createdAt: number;
    attempts: TCNSJobAttempt[];
    lockedUntil?: number;
    wait?: ECNSJobWait;
    state?: unknown;
};
