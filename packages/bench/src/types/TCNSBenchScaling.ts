/**
 * How one family's cost grows with size: the exponent `k` of a least-squares fit
 * of `log(medianNs)` against `log(n)`.
 *
 * Roughly: 1.0 linear, 2.0 quadratic, 0.0 flat. It is an approximation — a fixed
 * per-operation cost that does not scale drags the fitted exponent below the true
 * one, and four points cannot separate `n log n` from `n^1.1`. That is fine for
 * the purpose: what is watched is the exponent MOVING between two runs, and a
 * derivation that goes from linear to quadratic moves it by about a whole unit.
 *
 * Unlike a duration, this number means the same thing on every machine.
 */
export type TCNSBenchScaling = {
    family: string;
    /** The sizes measured, ascending. */
    sizes: number[];
    /** Median nanoseconds per operation at each size, aligned with `sizes`. */
    medianNs: number[];
    /** Fitted exponent `k` in `time ~ n^k`. */
    exponent: number;
    /**
     * Coefficient of determination of the log-log fit, 0..1. Below ~0.9 the
     * points are not on a power curve at all and the exponent means little —
     * the reporter says so rather than printing it bare.
     */
    rSquared: number;
};
