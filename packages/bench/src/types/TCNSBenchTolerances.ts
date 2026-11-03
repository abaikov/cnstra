/**
 * How much a metric may move before the comparator calls it a regression.
 *
 * These numbers are the honest core of this package, so the reasoning is here
 * rather than in a commit message.
 *
 * A JavaScript microbenchmark on a laptop does not repeat to within 5%. Thermal
 * throttling, another process waking up, the allocator landing objects in a
 * different cache line, a Node patch release changing an inline-cache
 * heuristic — any one of those moves a median by several percent with nothing
 * whatsoever having changed in the code. A gate set at 5% would fire on noise,
 * and a gate that fires on noise gets muted within a week, at which point the
 * whole apparatus is decoration.
 *
 * So the defaults are set where a fired gate is worth reading: they catch the
 * class of change that is structural — an allocation added to every hop, an
 * `await` on a path that used to be synchronous, a lookup that became a scan —
 * and they let a few percent of micro-tuning through unremarked. That trade is
 * made knowingly; see the README's "What this catches and what it misses".
 *
 * On top of the fixed number, every metric's threshold is widened to at least
 * twice the measured spread of the two runs being compared. A case that wobbles
 * by 15% on this machine cannot be judged at 25%, and the comparator says so in
 * the entry's note instead of pretending otherwise.
 */
export type TCNSBenchTolerances = {
    /**
     * Percentage a case's median nanoseconds may grow. Default 25.
     *
     * Only applied when both reports come from the same machine and Node major;
     * otherwise the entry is skipped, because comparing absolute timings across
     * machines is not a weaker signal, it is not a signal.
     */
    casePercent: number;

    /**
     * Percentage the price of an option may grow — the cost of a response
     * listener, of the persistor, of tracing, as a multiple of the same flow
     * without it. Default 20.
     *
     * Tighter than the absolute tolerance and applied on every machine: both
     * sides of a ratio move together when the hardware changes, so most of the
     * environmental noise cancels out.
     */
    ratioPercent: number;

    /**
     * How far a fitted growth exponent may drift, in exponent units. Default
     * 0.25.
     *
     * Linear to quadratic is +1.0, so 0.25 fires long before a derivation has
     * finished going bad, while staying well clear of the drift that comes from
     * fitting four noisy points.
     */
    scalingExponent: number;

    /**
     * Percentage the bytes allocated per operation may grow. Default 10.
     *
     * The tightest gate in the set, and the only one that deserves to be tight:
     * an exact allocation count does not vary with the machine, the load or the
     * hour of the day. It is judged everywhere, and skipped only when the probe
     * could not get a collection-free window on one of the two sides.
     */
    allocationPercent: number;
};
