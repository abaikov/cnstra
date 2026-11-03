import type { TCNSBenchCaseResult } from './types/TCNSBenchCaseResult';
import type { TCNSBenchScaling } from './types/TCNSBenchScaling';

/**
 * Fits each scaling family's measured points to `time ~ n^k` and reports `k`.
 *
 * Why this exists: a duration is a fact about a machine, but a growth exponent
 * is a fact about an algorithm. It is the one number in the report that can be
 * compared between a laptop and a CI box without apology, and it catches the
 * regression that matters most — a derivation that was linear in the number of
 * runs and is now quadratic in them.
 *
 * The fit is ordinary least squares on `log(medianNs)` against `log(n)`, which
 * is the standard way to read a power law off a handful of points.
 */
export class CNSBenchScalingAnalyzer {
    /** Group results by `scaling.family` and fit each group. Unmarked cases are ignored. */
    static analyze(results: TCNSBenchCaseResult[]): TCNSBenchScaling[] {
        const families = new Map<string, TCNSBenchCaseResult[]>();
        for (const result of results) {
            if (!result.scaling) continue;
            const bucket = families.get(result.scaling.family);
            if (bucket) bucket.push(result);
            else families.set(result.scaling.family, [result]);
        }

        const scalings: TCNSBenchScaling[] = [];
        for (const [family, members] of families) {
            // Two points always fit a straight line perfectly, which would make
            // rSquared a meaningless 1. A curve needs at least three.
            if (members.length < 3) continue;
            const ordered = [...members].sort(
                (a, b) => a.scaling!.n - b.scaling!.n
            );
            const sizes = ordered.map(m => m.scaling!.n);
            const medianNs = ordered.map(m => m.medianNs);
            const { slope, rSquared } = CNSBenchScalingAnalyzer.fitLogLog(
                sizes,
                medianNs
            );
            scalings.push({
                family,
                sizes,
                medianNs,
                exponent: slope,
                rSquared,
            });
        }
        return scalings.sort((a, b) => (a.family < b.family ? -1 : 1));
    }

    /** Least-squares slope and R² of `log(y)` on `log(x)`. */
    private static fitLogLog(
        xs: number[],
        ys: number[]
    ): { slope: number; rSquared: number } {
        const logX = xs.map(x => Math.log(x));
        const logY = ys.map(y => Math.log(y));
        const n = logX.length;
        const meanX = logX.reduce((s, v) => s + v, 0) / n;
        const meanY = logY.reduce((s, v) => s + v, 0) / n;

        let covariance = 0;
        let varianceX = 0;
        for (let i = 0; i < n; i++) {
            covariance += (logX[i]! - meanX) * (logY[i]! - meanY);
            varianceX += (logX[i]! - meanX) ** 2;
        }
        const slope = varianceX === 0 ? 0 : covariance / varianceX;
        const intercept = meanY - slope * meanX;

        let residualSum = 0;
        let totalSum = 0;
        for (let i = 0; i < n; i++) {
            const predicted = intercept + slope * logX[i]!;
            residualSum += (logY[i]! - predicted) ** 2;
            totalSum += (logY[i]! - meanY) ** 2;
        }
        const rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum;
        return { slope, rSquared };
    }
}
