/**
 * What one case measured. Everything here is per ONE operation as described by
 * {@link TCNSBenchCaseResult.operation} — never per batch, never per sample.
 *
 * A distribution, not a number: a single mean hides the GC pause that made the
 * run look slow and the turbo window that made it look fast.
 */
export type TCNSBenchCaseResult = {
    id: string;
    /** What one operation is. Copied from the case so a report reads alone. */
    operation: string;
    relativeTo?: string;
    scaling?: { family: string; n: number };

    /**
     * Operations per timed sample. Calibrated so a sample lasts longer than
     * `minSampleMs`, which is what keeps the clock's own resolution and the
     * loop's own overhead out of the number.
     */
    batchSize: number;
    /** How many timed samples the distribution below is built from. */
    sampleCount: number;
    /** `batchSize * sampleCount` — operations actually measured. */
    measuredOperations: number;
    /** Milliseconds of untimed warmup burned before the first sample. */
    warmupMs: number;

    /** Nanoseconds per operation, 50th percentile of the samples. */
    medianNs: number;
    /** 25th and 75th percentiles — the middle half of the samples. */
    p25Ns: number;
    p75Ns: number;
    /** Fastest sample seen. The closest thing to "no interference". */
    minNs: number;
    /**
     * Median absolute deviation as a percentage of the median: the spread
     * measure that a single GC pause cannot inflate. Read it as "how much this
     * case wobbles on this machine"; the comparator refuses to call a change a
     * regression unless the change is larger than this.
     */
    rmadPercent: number;
    /** `1e9 / medianNs`. Derived, carried so a reader need not divide. */
    opsPerSecond: number;

    /**
     * Bytes allocated on the JS heap per operation, or `NaN` when it could not
     * be measured cleanly. Unlike everything above it, this is not a timing: it
     * is the same number on every machine, which makes it the one figure here
     * that can be gated tightly.
     */
    allocationBytes: number;
    /** Operations the allocation probe needed for a collection-free window. */
    allocationOperations: number;
    /**
     * True when no garbage collection ran during the probe's window, which is
     * what makes {@link allocationBytes} an exact count rather than a guess.
     * The comparator refuses to judge an inexact measurement.
     */
    allocationExact: boolean;
};
