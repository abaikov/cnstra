import { CNSBenchMachine } from './CNSBenchMachine';
import type {
    TCNSBenchComparison,
    TCNSBenchComparisonEntry,
} from './types/TCNSBenchComparison';
import type { TCNSBenchReport } from './types/TCNSBenchReport';
import type { TCNSBenchTolerances } from './types/TCNSBenchTolerances';

/**
 * Reads a current report against a stored baseline and says what moved.
 *
 * Three metric kinds, judged on three different rules, because they are not
 * equally trustworthy:
 *
 * 1. **Absolute timings** — judged only when the baseline came from the same
 *    machine and Node major. Across machines they are skipped outright rather
 *    than scaled by some fudge factor; there is no honest conversion between
 *    two CPUs.
 * 2. **Ratios** (the price of a listener, a persistor, tracing) — judged
 *    everywhere. Both halves move together with the hardware, so the quotient
 *    is close to portable.
 * 3. **Growth exponents** — judged everywhere, in exponent units. A derivation
 *    that goes from linear to quadratic moves this by about 1.0 whatever it is
 *    running on.
 *
 * WHERE THE THRESHOLD COMES FROM. Not from one flat number, and not from the
 * spread of the samples inside a run. A metric's threshold is the largest of:
 *
 *   - the configured tolerance,
 *   - twice the RUN-TO-RUN spread the baseline recorded for that metric
 *     ({@link TCNSBenchReport.spread}, filled in by `bench:baseline` from
 *     several runs),
 *   - twice the within-run sample spread of the two reports being compared.
 *
 * The middle term is the one that matters and the one that used to be missing.
 * Widening by within-run spread alone let `observe/response-listener` — 1.0%
 * wobble inside a run, 86.7% between runs — be judged at 25%, and two compares
 * of unchanged code against the same baseline flagged three regressions and
 * then eight, a different set each time. A case that lands in a different JIT
 * tier or heap layout per process is stable inside a run by construction, so
 * the run is the wrong place to ask.
 *
 * Every entry whose threshold was widened says by which term, so a wide gate is
 * readable rather than mysterious.
 */
export class CNSBenchComparator {
    static readonly defaultTolerances: TCNSBenchTolerances = {
        casePercent: 25,
        ratioPercent: 20,
        scalingExponent: 0.25,
        allocationPercent: 10,
    };

    constructor(
        private readonly tolerances: TCNSBenchTolerances = CNSBenchComparator.defaultTolerances
    ) {}

    compare(
        baseline: TCNSBenchReport,
        current: TCNSBenchReport
    ): TCNSBenchComparison {
        if (baseline.schemaVersion !== current.schemaVersion) {
            throw new Error(
                `[bench] baseline schema ${baseline.schemaVersion} cannot be read against ` +
                    `report schema ${current.schemaVersion}. Record a fresh baseline.`
            );
        }

        const sameMachine = CNSBenchMachine.isSame(
            baseline.machine,
            current.machine
        );
        const entries: TCNSBenchComparisonEntry[] = [
            ...this.compareAllocations(baseline, current),
            ...this.compareCases(baseline, current, sameMachine),
            ...this.compareRatios(baseline, current),
            ...this.compareScalings(baseline, current),
        ];

        return {
            sameMachine,
            entries,
            regressionCount: entries.filter(e => e.verdict === 'regression')
                .length,
            suspectCount: entries.filter(e => e.verdict === 'suspect').length,
            unmatched: CNSBenchComparator.findUnmatched(baseline, current),
        };
    }

    /**
     * The allocation gate: bytes per operation, judged on every machine.
     *
     * There is no noise floor to widen by, because an exact count has no noise.
     * What it has instead is a precondition — a collection-free probe window —
     * and when either side failed to get one the entry is skipped outright.
     */
    private compareAllocations(
        baseline: TCNSBenchReport,
        current: TCNSBenchReport
    ): TCNSBenchComparisonEntry[] {
        const baseById = new Map(baseline.cases.map(c => [c.id, c]));
        const entries: TCNSBenchComparisonEntry[] = [];
        for (const now of current.cases) {
            const before = baseById.get(now.id);
            if (!before) continue;
            if (!before.allocationExact || !now.allocationExact) {
                entries.push({
                    metric: `alloc:${now.id}`,
                    unit: 'bytes/op',
                    baselineValue: before.allocationBytes,
                    currentValue: now.allocationBytes,
                    delta: 0,
                    deltaUnit: 'percent',
                    threshold: Number.POSITIVE_INFINITY,
                    verdict: 'skipped',
                    note: 'a garbage collection ran inside the probe window, so the count is not exact',
                });
                continue;
            }
            entries.push(
                CNSBenchComparator.judge({
                    metric: `alloc:${now.id}`,
                    unit: 'bytes/op',
                    baselineValue: before.allocationBytes,
                    currentValue: now.allocationBytes,
                    delta: CNSBenchComparator.percentChange(
                        before.allocationBytes,
                        now.allocationBytes
                    ),
                    deltaUnit: 'percent',
                    tolerance: this.tolerances.allocationPercent,
                    // An exact count has no sample noise, so the only floor an
                    // allocation gets is what the recording actually saw move.
                    ...CNSBenchComparator.floorOf(baseline, `alloc:${now.id}`, 0),
                })
            );
        }
        return entries;
    }

    private compareCases(
        baseline: TCNSBenchReport,
        current: TCNSBenchReport,
        sameMachine: boolean
    ): TCNSBenchComparisonEntry[] {
        const baseById = new Map(baseline.cases.map(c => [c.id, c]));
        const entries: TCNSBenchComparisonEntry[] = [];
        for (const now of current.cases) {
            const before = baseById.get(now.id);
            if (!before) continue;
            const delta = CNSBenchComparator.percentChange(
                before.medianNs,
                now.medianNs
            );
            if (!sameMachine) {
                entries.push({
                    metric: `case:${now.id}`,
                    unit: 'ns/op',
                    baselineValue: before.medianNs,
                    currentValue: now.medianNs,
                    delta,
                    deltaUnit: 'percent',
                    threshold: Number.POSITIVE_INFINITY,
                    verdict: 'skipped',
                    note:
                        `baseline is from ${baseline.machine.key}, this run is from ` +
                        `${current.machine.key} — absolute timings are not comparable`,
                });
                continue;
            }
            entries.push(
                CNSBenchComparator.judge({
                    metric: `case:${now.id}`,
                    unit: 'ns/op',
                    baselineValue: before.medianNs,
                    currentValue: now.medianNs,
                    delta,
                    deltaUnit: 'percent',
                    tolerance: this.tolerances.casePercent,
                    ...CNSBenchComparator.floorOf(
                        baseline,
                        `case:${now.id}`,
                        2 * Math.max(before.rmadPercent, now.rmadPercent)
                    ),
                })
            );
        }
        return entries;
    }

    private compareRatios(
        baseline: TCNSBenchReport,
        current: TCNSBenchReport
    ): TCNSBenchComparisonEntry[] {
        const baseById = new Map(baseline.ratios.map(r => [r.id, r]));
        const entries: TCNSBenchComparisonEntry[] = [];
        for (const now of current.ratios) {
            const before = baseById.get(now.id);
            if (!before) continue;
            entries.push(
                CNSBenchComparator.judge({
                    metric: `ratio:${now.id}`,
                    unit: `x ${now.baseId}`,
                    baselineValue: before.ratio,
                    currentValue: now.ratio,
                    delta: CNSBenchComparator.percentChange(
                        before.ratio,
                        now.ratio
                    ),
                    deltaUnit: 'percent',
                    tolerance: this.tolerances.ratioPercent,
                    ...CNSBenchComparator.floorOf(
                        baseline,
                        `ratio:${now.id}`,
                        2 * Math.max(before.noisePercent, now.noisePercent)
                    ),
                })
            );
        }
        return entries;
    }

    private compareScalings(
        baseline: TCNSBenchReport,
        current: TCNSBenchReport
    ): TCNSBenchComparisonEntry[] {
        const baseByFamily = new Map(
            baseline.scalings.map(s => [s.family, s])
        );
        const entries: TCNSBenchComparisonEntry[] = [];
        for (const now of current.scalings) {
            const before = baseByFamily.get(now.family);
            if (!before) continue;
            // A fit that does not describe a power curve carries no exponent
            // worth gating on; say so rather than failing a build on it.
            const poorFit = now.rSquared < 0.9 || before.rSquared < 0.9;
            const entry = CNSBenchComparator.judge({
                metric: `scaling:${now.family}`,
                unit: 'exponent',
                baselineValue: before.exponent,
                currentValue: now.exponent,
                delta: now.exponent - before.exponent,
                deltaUnit: 'absolute',
                tolerance: this.tolerances.scalingExponent,
                ...CNSBenchComparator.floorOf(
                    baseline,
                    `scaling:${now.family}`,
                    0
                ),
            });
            if (poorFit && entry.verdict === 'regression') {
                entry.verdict = 'suspect';
                entry.note =
                    `exponent moved past the tolerance, but the log-log fit is weak ` +
                    `(R²: baseline ${before.rSquared.toFixed(2)}, current ` +
                    `${now.rSquared.toFixed(2)}) — read the per-size timings before acting`;
            }
            entries.push(entry);
        }
        return entries;
    }

    /**
     * The floor a metric's threshold may not go below, and where it came from.
     *
     * Two candidates: the run-to-run spread the baseline recorded for this
     * metric (doubled), and the within-run sample spread of the two reports
     * (already doubled by the caller). The larger wins, and its origin is
     * carried so the entry's note can name it — a gate that widened itself
     * without saying why is how this one stopped being read.
     */
    private static floorOf(
        baseline: TCNSBenchReport,
        metric: string,
        sampleFloor: number
    ): { noiseFloor: number; noiseFloorSource: string } {
        const recorded = baseline.spread[metric];
        if (!Number.isFinite(recorded)) {
            return {
                noiseFloor: sampleFloor,
                noiseFloorSource:
                    "twice the reports' within-run sample spread (this " +
                    'baseline recorded no run-to-run spread for the metric)',
            };
        }
        const recordedFloor = 2 * (recorded as number);
        return recordedFloor >= sampleFloor
            ? {
                  noiseFloor: recordedFloor,
                  noiseFloorSource:
                      "twice this metric's recorded run-to-run spread of " +
                      `${(recorded as number).toFixed(1)}`,
              }
            : {
                  noiseFloor: sampleFloor,
                  noiseFloorSource:
                      "twice the reports' within-run sample spread",
              };
    }

    /**
     * Turn a movement into a verdict.
     *
     * The threshold is the configured tolerance or the floor from
     * {@link CNSBenchComparator.floorOf}, whichever is larger. Between the floor
     * and the threshold sits `suspect`: the metric moved further than this case
     * usually wobbles, but not far enough to be worth failing anything over.
     * That band is where a slow drift shows up before it becomes a regression.
     */
    private static judge(input: {
        metric: string;
        unit: string;
        baselineValue: number;
        currentValue: number;
        delta: number;
        deltaUnit: 'percent' | 'absolute';
        tolerance: number;
        noiseFloor: number;
        noiseFloorSource?: string;
    }): TCNSBenchComparisonEntry {
        const threshold = Math.max(input.tolerance, input.noiseFloor);
        const widened = threshold > input.tolerance;

        let verdict: TCNSBenchComparisonEntry['verdict'] = 'unchanged';
        if (input.delta >= threshold) verdict = 'regression';
        else if (input.delta >= Math.max(input.noiseFloor, input.tolerance / 2))
            verdict = 'suspect';
        else if (input.delta <= -threshold) verdict = 'improvement';

        return {
            metric: input.metric,
            unit: input.unit,
            baselineValue: input.baselineValue,
            currentValue: input.currentValue,
            delta: input.delta,
            deltaUnit: input.deltaUnit,
            threshold,
            verdict,
            ...(widened
                ? {
                      note:
                          `threshold widened from ${input.tolerance} to ` +
                          `${threshold.toFixed(1)} — ` +
                          (input.noiseFloorSource ??
                              "this metric's own spread"),
                  }
                : {}),
        };
    }

    private static percentChange(before: number, now: number): number {
        if (!Number.isFinite(before) || before === 0) return 0;
        return ((now - before) / before) * 100;
    }

    /** Metric names that exist on one side only — a renamed or new case. */
    private static findUnmatched(
        baseline: TCNSBenchReport,
        current: TCNSBenchReport
    ): string[] {
        const nameOf = (report: TCNSBenchReport): Set<string> =>
            new Set([
                ...report.cases.map(c => `case:${c.id}`),
                ...report.ratios.map(r => `ratio:${r.id}`),
                ...report.scalings.map(s => `scaling:${s.family}`),
            ]);
        const before = nameOf(baseline);
        const now = nameOf(current);
        const unmatched: string[] = [];
        for (const name of now) if (!before.has(name)) unmatched.push(name);
        for (const name of before) if (!now.has(name)) unmatched.push(name);
        return unmatched.sort();
    }
}
