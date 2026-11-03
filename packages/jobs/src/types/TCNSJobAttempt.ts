import type { ECNSJobAttemptStatus } from './ECNSJobAttemptStatus';
import type { TCNSJobCancelRequest } from './TCNSJobCancelRequest';

export type TCNSJobAttempt = {
    attemptNumber: number;
    startedAt: number;
    completedAt?: number;
    status?: ECNSJobAttemptStatus;
    errorName?: string;
    cancelRequest?: TCNSJobCancelRequest;
    meta?: Record<string, unknown>;
};
