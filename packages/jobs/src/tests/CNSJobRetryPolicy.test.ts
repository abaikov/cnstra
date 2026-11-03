import { describe, expect, it } from '@jest/globals';
import { CNSJobRetryPolicy } from '../retry/CNSJobRetryPolicy';
import type { ECNSJobAttemptStatus } from '../types/ECNSJobAttemptStatus';
import type { TCNSJobAttempt } from '../types/TCNSJobAttempt';
import type { TCNSJobRetry } from '../types/TCNSJobRetry';

const NOW = 1_000_000;

const attempts = (...statuses: ECNSJobAttemptStatus[]): TCNSJobAttempt[] =>
    statuses.map((status, index) => ({ attemptNumber: index + 1, startedAt: index, completedAt: index, status }));

const decide = (retry: TCNSJobRetry | undefined, statuses: ECNSJobAttemptStatus[], extra: { errorName?: string; random?: () => number } = {}) =>
    CNSJobRetryPolicy.decide({
        attempts: attempts(...statuses),
        retry,
        attemptStatus: statuses[statuses.length - 1] === 'stale' ? 'stale' : 'failed',
        now: NOW,
        random: () => 0.5,
        ...extra,
    });

describe('CNSJobRetryPolicy', () => {
    it('fails at the first failure by default', () => {
        expect(decide(undefined, ['failed'])).toEqual({ kind: 'final' });
    });

    it('retries stale attempts up to the default maxStale, right away', () => {
        expect(decide(undefined, ['stale', 'stale'])).toEqual({ kind: 'requeue', runAfter: NOW });
        expect(decide(undefined, ['stale', 'stale', 'stale'])).toEqual({ kind: 'final' });
    });

    it('stops at maxAttempts counted over failed and stale', () => {
        const retry = { maxAttempts: 3 };

        expect(decide(retry, ['failed', 'stale'])).toEqual({ kind: 'requeue', runAfter: NOW });
        expect(decide(retry, ['failed', 'stale', 'failed'])).toEqual({ kind: 'final' });
    });

    it('does not spend the budget on snoozed and aborted attempts', () => {
        expect(decide({ maxFailed: 2 }, ['snoozed', 'aborted', 'snoozed', 'failed'])).toEqual({ kind: 'requeue', runAfter: NOW });
    });

    it('fails a non-retryable error at once', () => {
        expect(decide({ maxFailed: 5, nonRetryable: ['ValidationError'] }, ['failed'], { errorName: 'ValidationError' })).toEqual({
            kind: 'final',
        });
    });

    it('delays by a fixed backoff', () => {
        expect(decide({ maxFailed: 5, backoff: { type: 'fixed', delayMs: 300 } }, ['failed', 'failed'])).toEqual({
            kind: 'requeue',
            runAfter: NOW + 300,
        });
    });

    it('doubles an exponential backoff per failure and caps it at maxDelayMs', () => {
        const retry = { maxFailed: 10, backoff: { type: 'exponential' as const, delayMs: 100, maxDelayMs: 500 } };

        expect(decide(retry, ['failed'])).toEqual({ kind: 'requeue', runAfter: NOW + 100 });
        expect(decide(retry, ['failed', 'failed'])).toEqual({ kind: 'requeue', runAfter: NOW + 200 });
        expect(decide(retry, ['failed', 'failed', 'failed'])).toEqual({ kind: 'requeue', runAfter: NOW + 400 });
        expect(decide(retry, ['failed', 'failed', 'failed', 'failed'])).toEqual({ kind: 'requeue', runAfter: NOW + 500 });
    });

    it('keeps an exponential backoff finite after many failures', () => {
        const statuses = Array.from({ length: 2000 }, () => 'failed' as const);

        const decision = decide({ maxFailed: 5000, backoff: { type: 'exponential', delayMs: 1000 } }, statuses);

        expect(decision.kind).toBe('requeue');
        expect(decision.kind === 'requeue' && Number.isFinite(decision.runAfter)).toBe(true);
    });

    it('subtracts jitter from the delay', () => {
        const decision = decide({ maxFailed: 5, backoff: { type: 'fixed', delayMs: 1000, jitter: 0.5 } }, ['failed'], {
            random: () => 0.5,
        });

        expect(decision).toEqual({ kind: 'requeue', runAfter: NOW + 750 });
    });

    it('retries a stale attempt right away even with a backoff', () => {
        expect(decide({ maxStale: 5, backoff: { type: 'fixed', delayMs: 1000 } }, ['stale'])).toEqual({
            kind: 'requeue',
            runAfter: NOW,
        });
    });
});
