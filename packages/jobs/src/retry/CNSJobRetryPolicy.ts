import { CNSJobAttempts } from '../job/CNSJobAttempts';
import type { TCNSJobAttempt } from '../types/TCNSJobAttempt';
import type { TCNSJobRetry } from '../types/TCNSJobRetry';
import type { TCNSJobRetryDecision } from '../types/TCNSJobRetryDecision';

export class CNSJobRetryPolicy {
    static readonly DEFAULT_MAX_FAILED = 1;
    static readonly DEFAULT_MAX_STALE = 3;

    static decide(params: {
        attempts: readonly TCNSJobAttempt[];
        retry?: TCNSJobRetry;
        attemptStatus: 'failed' | 'stale';
        errorName?: string;
        now: number;
        random?: () => number;
    }): TCNSJobRetryDecision {
        const retry = params.retry ?? {};
        if (params.attemptStatus === 'failed' && params.errorName && retry.nonRetryable?.includes(params.errorName)) {
            return { kind: 'final' };
        }

        const { failed, stale } = CNSJobAttempts.budget(params.attempts);
        const maxFailed = retry.maxFailed ?? retry.maxAttempts ?? CNSJobRetryPolicy.DEFAULT_MAX_FAILED;
        const maxStale = retry.maxStale ?? CNSJobRetryPolicy.DEFAULT_MAX_STALE;
        if (retry.maxAttempts !== undefined && failed + stale >= retry.maxAttempts) return { kind: 'final' };
        if (failed >= maxFailed || stale >= maxStale) return { kind: 'final' };

        const backoff = retry.backoff;
        if (params.attemptStatus === 'stale' || !backoff) return { kind: 'requeue', runAfter: params.now };

        const exponent = Math.min(Math.max(0, failed - 1), 52);
        const base = backoff.type === 'exponential' ? backoff.delayMs * 2 ** exponent : backoff.delayMs;
        const capped = Math.min(base, backoff.maxDelayMs ?? Number.MAX_SAFE_INTEGER);
        const jitter = Math.min(Math.max(backoff.jitter ?? 0, 0), 1);
        const delay = capped * (1 - jitter * (params.random ?? Math.random)());
        return { kind: 'requeue', runAfter: params.now + Math.round(delay) };
    }
}
