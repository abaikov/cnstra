import { PerformanceObserver } from 'node:perf_hooks';

import { CNSBenchStatistics } from './CNSBenchStatistics';
import type { TCNSBenchBody } from './types/TCNSBenchBody';

/**
 * Bytes allocated per operation — the one metric here that is not a timing, and
 * so the one that reads the same on every machine.
 *
 * `heapUsed` reports what is live, so a window's delta is the allocation only if
 * no collection ran inside it. A collector observer watches for that, and a
 * window that saw one is thrown away — see {@link CNSBenchAllocationProbe.settle}
 * for how long that check has to wait, and what believing a shorter wait cost.
 *
 * THE ESTIMATOR, and why it is a slope rather than a delta. A clean window of
 * `n` operations moves `heapUsed` by `n * perOperation + C`, where `C` is what
 * the window itself costs: two `memoryUsage()` calls, the loop, the observer's
 * own bookkeeping, plus whatever unrelated allocation happened to land inside.
 * Dividing a single window by `n` charges all of `C` to the operations, and the
 * smaller the window the worse that is.
 *
 * Two windows at `n` and `2n` subtract it away exactly:
 *
 *     d(2n) - d(n) = (2n * perOp + C) - (n * perOp + C) = n * perOp
 *
 * What is left is the slope, and `C` is not in it. Several such pairs are taken
 * and the MEDIAN slope is the answer, because contamination is not one-sided
 * once a slope is involved: foreign allocation inside the small window pushes
 * the slope down, inside the large window it pushes it up. A maximum would
 * believe every upward push — which is exactly what the previous estimator did,
 * and why `engine/linear-chain-8` read 44% apart across three runs of identical
 * code while every other case held to within 1.1%.
 *
 * The pairs also make the probe able to say when it has NOT converged: if the
 * slopes disagree by more than
 * {@link CNSBenchAllocationProbe.uncertaintyPercent}, the result is reported
 * inexact and the comparator declines to gate on it. That check is the whole
 * point — a number this gate trusts to 10% has to know when it is guessing.
 */
export class CNSBenchAllocationProbe {
    /**
     * Slopes to gather before answering.
     *
     * Nine, measured rather than guessed. `heapUsed` moves in chunks, so a
     * single slope carries a few percent of quantisation noise, and the median's
     * own certainty improves with the count. Probing an operation that retains
     * ~4.1 kB, five times over, at each count:
     *
     *     pairs=5   the median reproduced to 32.3%
     *     pairs=7   to 2.3%
     *     pairs=9   to 1.7%
     *
     * Nine costs eighteen windows per case, against the old estimator's up to
     * eight — the price of a number the 10% allocation gate can stand on.
     */
    private static readonly pairs = 9;
    /** Window sizes to try; each attempt halves both halves of the pair. */
    private static readonly maxAttempts = 6;
    /** Pairs that must survive a collection-free check for an answer at all. */
    private static readonly minSlopes = 3;
    /**
     * How uncertain the median may be and still be called exact, in percent.
     *
     * Uncertainty here is the spread of the middle half of the slopes divided by
     * the square root of how many there were — a median of `k` samples is that
     * much more settled than any one of them. In the same measurement, every
     * probe whose median landed within 2% of the truth reported 0.0–1.5%, and
     * the one that was 30% wrong reported 10.6%. Five sits between them with
     * room on both sides.
     */
    private static readonly uncertaintyPercent = 5;

    static async measure(
        run: TCNSBenchBody['run'],
        maxOperations: number
    ): Promise<{
        bytesPerOperation: number;
        operations: number;
        exact: boolean;
    }> {
        // The large half of the pair is the budget; the small half is half of it.
        // No floor on the window size: the fixed per-window cost cancels in the
        // slope, which is what the old estimator needed a floor to survive.
        let small = Math.max(1, Math.floor(maxOperations / 2));

        for (
            let attempt = 0;
            attempt < CNSBenchAllocationProbe.maxAttempts;
            attempt++
        ) {
            const big = small * 2;
            const slopes: number[] = [];

            for (let pair = 0; pair < CNSBenchAllocationProbe.pairs; pair++) {
                const short = await CNSBenchAllocationProbe.cleanWindow(
                    run,
                    small
                );
                const long = await CNSBenchAllocationProbe.cleanWindow(
                    run,
                    big
                );
                // A pair where the larger window grew the heap LESS than the
                // smaller one cannot be read as a slope — something outside the
                // operation moved, or a collection slipped past the observer.
                if (short === undefined || long === undefined) continue;
                if (long < short) continue;
                slopes.push((long - short) / small);
            }

            if (slopes.length >= CNSBenchAllocationProbe.minSlopes) {
                const sorted = [...slopes].sort((a, b) => a - b);
                const median = CNSBenchStatistics.percentileOfSorted(
                    sorted,
                    0.5
                );
                const p25 = CNSBenchStatistics.percentileOfSorted(sorted, 0.25);
                const p75 = CNSBenchStatistics.percentileOfSorted(sorted, 0.75);
                const middleHalf = median > 0 ? ((p75 - p25) / median) * 100 : 0;
                const uncertainty = middleHalf / Math.sqrt(slopes.length);
                return {
                    bytesPerOperation: median,
                    operations: big,
                    exact:
                        uncertainty <=
                        CNSBenchAllocationProbe.uncertaintyPercent,
                };
            }

            // Too many windows saw a collection. A window big enough to trigger
            // one triggers it every time, so retrying the same size only fails
            // the same way; halve it.
            if (small === 1) break;
            small = Math.max(1, Math.floor(small / 2));
        }

        return {
            bytesPerOperation: Number.NaN,
            operations: small * 2,
            exact: false,
        };
    }

    /**
     * One window's `heapUsed` delta, or `undefined` when a collection ran inside
     * it.
     *
     * The observer's entries arrive on a later turn, so the window is only known
     * to be clean after yielding once — and the yield before it is what keeps
     * the PREVIOUS window's entries from being counted against this one.
     */
    private static async cleanWindow(
        run: TCNSBenchBody['run'],
        operations: number
    ): Promise<number | undefined> {
        let collections = 0;
        const observer = new PerformanceObserver(list => {
            collections += list.getEntries().length;
        });
        observer.observe({ entryTypes: ['gc'] });

        try {
            await CNSBenchAllocationProbe.settle();
            collections = 0;

            const before = process.memoryUsage().heapUsed;
            for (let index = 0; index < operations; index++) {
                const pending = run();
                if (pending) await pending;
            }
            const after = process.memoryUsage().heapUsed;

            await CNSBenchAllocationProbe.settle();

            if (collections !== 0) return undefined;
            if (after < before) return undefined;
            return after - before;
        } finally {
            observer.disconnect();
        }
    }

    /**
     * Yield long enough for the collector's performance entries to arrive.
     *
     * One `setImmediate` is NOT long enough, and believing it was is why this
     * probe reported `exact: true` for every window it ever took. Measured on
     * `engine/linear-chain-64`, windows of 256 and 1024 operations:
     *
     *     gc entries seen right after the window        0    0
     *     after one setImmediate                        0    0
     *     after a setTimeout(0) and one more            1    5
     *
     * Meanwhile `heapUsed` dropped inside both windows — 3.8 MB and 14.6 MB —
     * so both windows had collected and both were called clean. A macrotask
     * turn plus a microtask drain is what it takes to see them.
     */
    private static settle(): Promise<void> {
        return new Promise<void>(resolve => {
            setTimeout(() => setImmediate(resolve), 0);
        });
    }
}
