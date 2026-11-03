import type { TCNSJobRetry } from './TCNSJobRetry';

export type TCNSJob<TPayload = unknown> = {
    jobType: string;
    payload: TPayload;
    jobId?: string;
    meta?: Record<string, unknown>;
    retry?: TCNSJobRetry;
    jobKey?: string;
    jobGroup?: string;
    priority?: number;
    runAfter?: number;
    createdAt?: number;
};
