import { describe, expect, it } from '@jest/globals';
import { CNSJobRateLimiter } from '../rate/CNSJobRateLimiter';

describe('CNSJobRateLimiter', () => {
    const rate = { max: 3, durationMs: 300 };

    it('grants everything without a rate and clears the throttle', () => {
        expect(CNSJobRateLimiter.take(undefined, 0, undefined, 7)).toEqual({ granted: 7, nextStartAt: undefined });
    });

    it('grants nothing while a throttle is in the future', () => {
        expect(CNSJobRateLimiter.take(500, 100, undefined, 7)).toEqual({ granted: 0, nextStartAt: 500 });
    });

    it('allows a burst of max, then one start per emission interval', () => {
        const burst = CNSJobRateLimiter.take(undefined, 1000, rate, 10);
        expect(burst.granted).toBe(3);

        expect(CNSJobRateLimiter.take(burst.nextStartAt, 1000, rate, 10).granted).toBe(0);
        expect(CNSJobRateLimiter.take(burst.nextStartAt, 1099, rate, 10).granted).toBe(0);

        const next = CNSJobRateLimiter.take(burst.nextStartAt, 1100, rate, 10);
        expect(next.granted).toBe(1);
        expect(CNSJobRateLimiter.take(next.nextStartAt, 1100, rate, 10).granted).toBe(0);
    });

    it('refills the full burst after a quiet period', () => {
        const burst = CNSJobRateLimiter.take(undefined, 0, rate, 3);

        expect(CNSJobRateLimiter.take(burst.nextStartAt, 10_000, rate, 10).granted).toBe(3);
    });

    it('holds the long-run rate to max per durationMs plus one burst', () => {
        let nextStartAt: number | undefined;
        const starts: number[] = [];
        for (let now = 0; now < 3000; now += 7) {
            const taken = CNSJobRateLimiter.take(nextStartAt, now, rate, 2);
            nextStartAt = taken.nextStartAt;
            for (let index = 0; index < taken.granted; index++) starts.push(now);
        }

        expect(starts.length).toBeLessThanOrEqual((3000 / rate.durationMs) * rate.max + rate.max);
        expect(starts.length).toBeGreaterThanOrEqual((3000 / rate.durationMs) * rate.max - 1);
        for (const start of starts) {
            expect(starts.filter(other => other >= start && other < start + rate.durationMs).length).toBeLessThanOrEqual(2 * rate.max - 1);
        }
    });

    it('stays exact at large timestamps where the interval is fractional', () => {
        const thirds = { max: 3, durationMs: 1000 };
        const now = 1_700_000_000_000;
        const burst = CNSJobRateLimiter.take(undefined, now, thirds, 3);

        expect(burst.granted).toBe(3);
        expect(CNSJobRateLimiter.take(burst.nextStartAt, now + 1000, thirds, 3).granted).toBe(3);
    });

    it('treats max 0 as paused and durationMs 0 as unlimited', () => {
        expect(CNSJobRateLimiter.take(undefined, 0, { max: 0, durationMs: 100 }, 5).granted).toBe(0);
        expect(CNSJobRateLimiter.take(undefined, 0, { max: 1, durationMs: 0 }, 5).granted).toBe(5);
    });
});
