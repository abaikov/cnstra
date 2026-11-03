/**
 * One metric, then and now, with a verdict and the reason behind it.
 *
 * The verdicts are deliberately coarse. `regression` is the only one a
 * `--check` can fail on, and it is reserved for a change too large for noise to
 * explain — see {@link TCNSBenchComparisonEntry.threshold}.
 */
export type TCNSBenchComparisonEntry = {
    /** `case:<id>`, `ratio:<id>` or `scaling:<family>`. */
    metric: string;
    /** What the two values are: `ns/op`, `x baseline`, or `exponent`. */
    unit: string;
    baselineValue: number;
    currentValue: number;

    /**
     * How far the metric moved. Positive is worse for all three metric kinds —
     * they are all "smaller is better".
     */
    delta: number;
    /**
     * `percent` for timings and ratios, where a proportional change is the
     * meaningful one; `absolute` for a growth exponent, where the distance from
     * linear to quadratic is one unit however large the exponent already was.
     */
    deltaUnit: 'percent' | 'absolute';
    /**
     * What `delta` had to exceed to be called a regression: the configured
     * tolerance, widened to cover the measured noise of the two runs whenever
     * that noise is larger. In the same unit as `delta`.
     */
    threshold: number;

    verdict: 'regression' | 'suspect' | 'unchanged' | 'improvement' | 'skipped';
    /** Why this verdict — including why a metric was skipped. */
    note?: string;
};

/** The whole comparison, with the one-line answer at the top. */
export type TCNSBenchComparison = {
    /** True when the two reports agree on machine, CPU and Node major. */
    sameMachine: boolean;
    entries: TCNSBenchComparisonEntry[];
    regressionCount: number;
    suspectCount: number;
    /** Metrics present in one report and not the other, by name. */
    unmatched: string[];
};
