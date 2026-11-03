import { describe, expect, it } from '@jest/globals';
import { CNSJobAttempts } from '../job/CNSJobAttempts';
import type { ECNSJobAttemptStatus } from '../types/ECNSJobAttemptStatus';
import type { TCNSJobAttempt } from '../types/TCNSJobAttempt';

const attempt = (attemptNumber: number, status?: ECNSJobAttemptStatus): TCNSJobAttempt => ({
    attemptNumber,
    startedAt: attemptNumber,
    completedAt: status === undefined ? undefined : attemptNumber,
    status,
});

describe('CNSJobAttempts', () => {
    it('finds the open attempt only when it is the last one and has not completed', () => {
        const attempts = [attempt(1, 'failed'), attempt(2)];

        expect(CNSJobAttempts.open(attempts, 2)).toBe(attempts[1]);
        expect(CNSJobAttempts.open(attempts, 1)).toBeUndefined();
        expect(CNSJobAttempts.open([attempt(1, 'completed')], 1)).toBeUndefined();
        expect(CNSJobAttempts.open([], 1)).toBeUndefined();
    });

    it('numbers the next attempt after the last one', () => {
        expect(CNSJobAttempts.nextNumber([])).toBe(1);
        expect(CNSJobAttempts.nextNumber([attempt(7, 'failed')])).toBe(8);
    });

    it('counts failed and stale only, and started by attempt numbers', () => {
        const budget = CNSJobAttempts.budget([
            attempt(1, 'failed'),
            attempt(2, 'snoozed'),
            attempt(3, 'aborted'),
            attempt(4, 'stale'),
            attempt(5),
        ]);

        expect(budget).toEqual({ failed: 1, stale: 1, started: 5 });
    });

    it('counts the budget only after the last retried marker', () => {
        const budget = CNSJobAttempts.budget([
            attempt(1, 'failed'),
            attempt(2, 'failed'),
            { ...attempt(2, 'retried') },
            attempt(3, 'stale'),
        ]);

        expect(budget).toEqual({ failed: 0, stale: 1, started: 1 });
    });

    it('keeps started counting right after trimming dropped early attempts', () => {
        const attempts = Array.from({ length: 80 }, (_, index) => attempt(index + 1, 'snoozed'));

        const trimmed = CNSJobAttempts.trim(attempts);

        expect(trimmed).toHaveLength(CNSJobAttempts.KEEP);
        expect(CNSJobAttempts.budget(trimmed).started).toBe(80);
    });

    it('keeps the last attempt, the retried marker and every budget attempt after it when trimming', () => {
        const attempts = [
            attempt(1, 'failed'),
            { ...attempt(1, 'retried') },
            attempt(2, 'failed'),
            ...Array.from({ length: 10 }, (_, index) => attempt(index + 3, 'snoozed')),
            attempt(13, 'stale'),
            attempt(14),
        ];

        const trimmed = CNSJobAttempts.trim(attempts, 4);

        expect(trimmed.map(kept => [kept.attemptNumber, kept.status])).toEqual([
            [1, 'retried'],
            [2, 'failed'],
            [13, 'stale'],
            [14, undefined],
        ]);
        expect(CNSJobAttempts.budget(trimmed)).toEqual(CNSJobAttempts.budget(attempts));
    });

    it('returns a copy when nothing needs trimming', () => {
        const attempts = [attempt(1)];

        const trimmed = CNSJobAttempts.trim(attempts);

        expect(trimmed).toEqual(attempts);
        expect(trimmed).not.toBe(attempts);
    });
});
