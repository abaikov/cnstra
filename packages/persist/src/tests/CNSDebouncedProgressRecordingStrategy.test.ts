import { CNSDebouncedProgressRecordingStrategy } from '../CNSDebouncedProgressRecordingStrategy';
import type { TCNSStimulationResponse } from '@cnstra/types';

/**
 * The default strategy coalesces checkpoint writes during a burst and bounds how
 * stale the frontier may get. It used to re-arm on every response, which cost one
 * Node timer per hop to perform a single write; it now keeps one timer per quiet
 * window and asks, when that timer fires, how long the run has actually been
 * quiet.
 *
 * These pin the semantics that saving must not change: one flush after a burst,
 * counted from the LAST response, plus the immediate flush on an error and the
 * staleness ceiling.
 *
 * On fake timers throughout. The strategy reads the clock only through
 * `Date.now()` and `setTimeout`, both of which jest's modern fake timers drive,
 * so every case below is exact rather than a race against a 30ms window — which
 * is what these were, and they lost it under a loaded machine.
 */

const response = (over: Partial<TCNSStimulationResponse> = {}) =>
    ({
        queueLength: 1,
        pendingActivations: 0,
        activeActivations: 0,
        ...over,
    } as TCNSStimulationResponse);

describe('CNSDebouncedProgressRecordingStrategy', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('coalesces a burst into one flush', () => {
        const strategy = new CNSDebouncedProgressRecordingStrategy({
            debounceMs: 30,
            maxStalenessMs: 10_000,
        });
        let flushes = 0;
        const flush = () => {
            flushes++;
        };

        for (let i = 0; i < 20; i++) {
            strategy.onResponse(response(), flush);
            jest.advanceTimersByTime(2);
        }
        expect(flushes).toBe(0); // still inside the burst

        jest.advanceTimersByTime(30);
        expect(flushes).toBe(1);
        strategy.dispose();
    });

    it('counts the quiet window from the last response, not the first', () => {
        // The property a naive sampler would lose: it would have fired mid-burst.
        const strategy = new CNSDebouncedProgressRecordingStrategy({
            debounceMs: 40,
            maxStalenessMs: 10_000,
        });
        let flushes = 0;
        const flush = () => {
            flushes++;
        };

        strategy.onResponse(response(), flush);
        jest.advanceTimersByTime(30);
        strategy.onResponse(response(), flush);
        jest.advanceTimersByTime(30);

        // 60ms since the first response, 30ms since the last: not yet.
        expect(flushes).toBe(0);

        jest.advanceTimersByTime(10);
        expect(flushes).toBe(1);
        strategy.dispose();
    });

    it('flushes at once when a response carries an error', () => {
        const strategy = new CNSDebouncedProgressRecordingStrategy({
            debounceMs: 10_000,
        });
        let flushes = 0;

        strategy.onResponse(response({ error: new Error('boom') }), () => {
            flushes++;
        });

        expect(flushes).toBe(1);
        strategy.dispose();
    });

    it('flushes once the staleness ceiling is reached, burst or not', () => {
        const strategy = new CNSDebouncedProgressRecordingStrategy({
            debounceMs: 10_000,
            maxStalenessMs: 30,
        });
        let flushes = 0;
        const flush = () => {
            flushes++;
        };

        strategy.onResponse(response(), flush);
        jest.advanceTimersByTime(50);
        // The ceiling is checked on arrival, so the next response carries it.
        strategy.onResponse(response(), flush);

        expect(flushes).toBe(1);
        strategy.dispose();
    });

    it('arms one timer for a whole burst, not one per response', () => {
        // The saving itself, counted rather than timed.
        const strategy = new CNSDebouncedProgressRecordingStrategy({
            debounceMs: 25,
            maxStalenessMs: 10_000,
        });
        const flush = () => undefined;

        for (let i = 0; i < 30; i++) strategy.onResponse(response(), flush);

        // Thirty responses in one tick: one timer, not thirty.
        expect(jest.getTimerCount()).toBe(1);
        strategy.dispose();
    });

    it('stops its timer when disposed', () => {
        const strategy = new CNSDebouncedProgressRecordingStrategy({
            debounceMs: 10,
            maxStalenessMs: 10_000,
        });
        let flushes = 0;

        strategy.onResponse(response(), () => {
            flushes++;
        });
        strategy.dispose();
        jest.advanceTimersByTime(1000);

        expect(flushes).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });
});
