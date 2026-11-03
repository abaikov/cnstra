/**
 * The summary statistics a benchmark report is built from.
 *
 * Percentiles and a median absolute deviation, not a mean and a standard
 * deviation. A benchmark sample set is not normal: it is a tight cluster of
 * honest measurements with a tail of samples that caught a GC pause, a timer
 * interrupt or a frequency change. A mean chases that tail; a median ignores it.
 */
export class CNSBenchStatistics {
    /**
     * Linear-interpolated percentile of an ALREADY SORTED ascending array.
     * Sorting is the caller's job so a summary does not sort the same array
     * five times.
     */
    static percentileOfSorted(sorted: number[], fraction: number): number {
        if (sorted.length === 0) return Number.NaN;
        if (sorted.length === 1) return sorted[0]!;
        const position = (sorted.length - 1) * fraction;
        const lower = Math.floor(position);
        const upper = Math.ceil(position);
        if (lower === upper) return sorted[lower]!;
        return (
            sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
        );
    }

    /**
     * Median absolute deviation, as a percentage of the median.
     *
     * The spread number to read first. One GC pause moves a standard deviation a
     * long way and moves this hardly at all, so it answers the question actually
     * being asked — "how repeatable is this case on this machine right now" —
     * rather than "how long was the worst sample".
     */
    static relativeMedianAbsoluteDeviation(
        sorted: number[],
        median: number
    ): number {
        if (sorted.length === 0 || median === 0) return 0;
        const deviations = sorted
            .map(value => Math.abs(value - median))
            .sort((a, b) => a - b);
        const mad = CNSBenchStatistics.percentileOfSorted(deviations, 0.5);
        return (mad / median) * 100;
    }
}
