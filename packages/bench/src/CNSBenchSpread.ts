import { CNSBenchStatistics } from './CNSBenchStatistics';
import type { TCNSBenchReport } from './types/TCNSBenchReport';

/**
 * How far each metric moves between repeated runs of the SAME code.
 *
 * This is the number a gate has to clear, and nothing inside a single run can
 * supply it. Each case already reports `rmadPercent`, the spread of its samples
 * within one run, and the comparator used to widen its thresholds by that — but
 * the two spreads are not the same quantity and are not even correlated. The
 * three recordings that produced this class:
 *
 *     observe/response-listener   rmad 1.0%   run-to-run 86.7%
 *     frontier/hydrate-32         rmad 0.3%   run-to-run 42.2%
 *     roster/load-entries-400     rmad 0.3%   run-to-run  8.0%
 *
 * The first two are stable inside a process and land somewhere else in the next
 * one — a different JIT tier, a different inline-cache shape, a different heap
 * layout. `rmadPercent` cannot see that by construction, which is why widening
 * by it produced three regressions on one compare and eight on the next, on
 * unchanged code.
 *
 * Keys are the comparator's own metric names (`case:…`, `alloc:…`, `ratio:…`,
 * `scaling:…`) so a threshold is one lookup. Values are in each metric's delta
 * unit: percent for timings, allocations and ratios; absolute exponent units for
 * growth.
 */
export class CNSBenchSpread {
    /**
     * Fold several recordings into one spread table.
     *
     * Fewer than two recordings yields an empty table rather than zeros: zero
     * spread would read as "this metric never moves", which is the opposite of
     * "nobody measured whether it does".
     */
    static of(reports: readonly TCNSBenchReport[]): Record<string, number> {
        if (reports.length < 2) return {};

        const series = new Map<string, number[]>();
        const add = (metric: string, value: number): void => {
            if (!Number.isFinite(value)) return;
            const values = series.get(metric);
            if (values) values.push(value);
            else series.set(metric, [value]);
        };

        for (const report of reports) {
            for (const benchCase of report.cases) {
                add(`case:${benchCase.id}`, benchCase.medianNs);
                // Only exact counts. An inexact one is a lower bound, and the
                // gap between a bound and a measurement would be recorded here
                // as instability the metric does not have.
                if (benchCase.allocationExact) {
                    add(`alloc:${benchCase.id}`, benchCase.allocationBytes);
                }
            }
            for (const ratio of report.ratios) add(`ratio:${ratio.id}`, ratio.ratio);
            for (const scaling of report.scalings) {
                add(`scaling:${scaling.family}`, scaling.exponent);
            }
        }

        const spread: Record<string, number> = {};
        for (const [metric, values] of series) {
            if (values.length < 2) continue;
            const sorted = [...values].sort((a, b) => a - b);
            const range = sorted[sorted.length - 1] - sorted[0];
            // Growth exponents are compared in exponent units, so their spread
            // is a difference; everything else is compared in percent.
            if (metric.startsWith('scaling:')) {
                spread[metric] = range;
                continue;
            }
            const median = CNSBenchStatistics.percentileOfSorted(sorted, 0.5);
            spread[metric] = median > 0 ? (range / median) * 100 : 0;
        }
        return spread;
    }
}
