import type { TCNSJobBackoff } from './TCNSJobBackoff';

export type TCNSJobRetry = {
    maxAttempts?: number;
    maxFailed?: number;
    maxStale?: number;
    maxStarted?: number;
    backoff?: TCNSJobBackoff;
    nonRetryable?: string[];
};
