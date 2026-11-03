import type { TCNSBenchComparison } from './types/TCNSBenchComparison';
import type { TCNSBenchReport } from './types/TCNSBenchReport';
import type { TCNSBenchSuite } from './types/TCNSBenchSuite';

/**
 * Prints a report, and prints a comparison.
 *
 * Two rules it keeps, because they are what separate a measurement from a
 * number: every figure is printed with its unit and with what one operation
 * IS, and every figure is printed with its spread. A bare "1.2 µs" invites the
 * reader to believe a precision the run does not have.
 */
export class CNSBenchReporter {
    static printReport(report: TCNSBenchReport, suites: TCNSBenchSuite[]): void {
        const machine = report.machine;
        console.log('');
        console.log(
            `CNStra benchmarks — ${machine.platform}/${machine.arch}, ${machine.cpuModel}, ` +
                `${machine.cpuCount} cores, node ${machine.nodeVersion} (v8 ${machine.v8Version})`
        );
        console.log(
            `method: ${report.options.samples} samples/case, ` +
                `${report.options.warmupMs}ms warmup, ` +
                `batch calibrated to >= ${report.options.minSampleMs}ms per sample, ` +
                `forced GC between cases: ${report.options.forceGc ? 'yes' : 'no'}`
        );
        console.log(
            'figures are per ONE operation; median of the samples, with the middle half and the spread'
        );

        const summaryByName = new Map(suites.map(s => [s.name, s.summary]));
        const grouped = new Map<string, TCNSBenchReport['cases']>();
        for (const result of report.cases) {
            const suiteName = result.id.split('/')[0] ?? 'other';
            const bucket = grouped.get(suiteName);
            if (bucket) bucket.push(result);
            else grouped.set(suiteName, [result]);
        }

        for (const [suiteName, results] of grouped) {
            console.log('');
            console.log(
                `── ${suiteName} — ${summaryByName.get(suiteName) ?? ''}`
            );
            for (const result of results) {
                console.log(
                    `   ${result.id.padEnd(34)} ` +
                        `${CNSBenchReporter.duration(result.medianNs).padStart(12)}  ` +
                        `${CNSBenchReporter.integer(result.opsPerSecond).padStart(13)} ops/s  ` +
                        `IQR ${CNSBenchReporter.duration(result.p25Ns)}–${CNSBenchReporter.duration(result.p75Ns)}  ` +
                        `spread ±${result.rmadPercent.toFixed(1)}%  ` +
                        `[${result.sampleCount}×${result.batchSize}]`
                );
                console.log(
                    `      one op = ${result.operation}  |  allocates ` +
                        `${CNSBenchReporter.bytes(result.allocationBytes)}/op` +
                        (result.allocationExact
                            ? ''
                            : ' (inexact — a collection ran inside the probe window)')
                );
            }
        }

        if (report.ratios.length > 0) {
            console.log('');
            console.log(
                '── cost of an option — median of the case divided by median of the same flow without it'
            );
            for (const ratio of report.ratios) {
                console.log(
                    `   ${ratio.id.padEnd(34)} ` +
                        `${ratio.ratio.toFixed(2)}x  vs ${ratio.baseId}  ` +
                        `(noise ±${ratio.noisePercent.toFixed(1)}%)`
                );
            }
        }

        if (report.scalings.length > 0) {
            console.log('');
            console.log(
                '── growth — least-squares fit of time ~ n^k; 1.0 is linear, 2.0 quadratic'
            );
            for (const scaling of report.scalings) {
                const fitNote =
                    scaling.rSquared < 0.9
                        ? '  (weak fit — read the per-size timings instead)'
                        : '';
                console.log(
                    `   ${scaling.family.padEnd(34)} ` +
                        `k=${scaling.exponent.toFixed(2)}  R²=${scaling.rSquared.toFixed(3)}  ` +
                        `n=${scaling.sizes.join(',')}${fitNote}`
                );
            }
        }
        console.log('');
    }

    /**
     * What the repeated runs disagreed about, worst first.
     *
     * This is the table a threshold is built from, so it is printed rather than
     * only stored: a case at the top of it cannot be gated on tightly, and the
     * person recording the baseline is the one who should see that.
     */
    static printSpread(spread: Record<string, number>): void {
        const rows = Object.entries(spread).sort((a, b) => b[1] - a[1]);
        if (rows.length === 0) return;
        console.log('── run-to-run spread of these recordings (the gate is widened to twice it)');
        for (const [metric, value] of rows) {
            const unit = metric.startsWith('scaling:') ? '' : '%';
            console.log(
                `   ${metric.padEnd(44)} ${value.toFixed(1).padStart(7)}${unit}`
            );
        }
        console.log('');
    }

    static printComparison(comparison: TCNSBenchComparison): void {
        console.log('');
        console.log(
            comparison.sameMachine
                ? '── comparison against baseline (same machine: absolute timings are judged)'
                : '── comparison against baseline (DIFFERENT machine: absolute timings are skipped, ' +
                      'ratios and growth exponents are still judged)'
        );

        const interesting = comparison.entries.filter(
            entry => entry.verdict !== 'unchanged'
        );
        const shown = interesting.length > 0 ? interesting : comparison.entries;
        if (interesting.length === 0) {
            console.log(
                '   nothing moved beyond its threshold; showing all metrics'
            );
        }

        for (const entry of shown) {
            const sign = entry.delta >= 0 ? '+' : '';
            const delta =
                entry.deltaUnit === 'percent'
                    ? `${sign}${entry.delta.toFixed(1)}%`
                    : `${sign}${entry.delta.toFixed(2)}`;
            const threshold = Number.isFinite(entry.threshold)
                ? entry.deltaUnit === 'percent'
                    ? `${entry.threshold.toFixed(1)}%`
                    : entry.threshold.toFixed(2)
                : '—';
            console.log(
                `   ${CNSBenchReporter.verdictMark(entry.verdict)} ${entry.metric.padEnd(40)} ` +
                    `${CNSBenchReporter.number(entry.baselineValue).padStart(11)} → ` +
                    `${CNSBenchReporter.number(entry.currentValue).padStart(11)} ${entry.unit.padEnd(14)} ` +
                    `${delta.padStart(9)}  (threshold ${threshold})`
            );
            if (entry.note) console.log(`        ${entry.note}`);
        }

        if (comparison.unmatched.length > 0) {
            console.log('');
            console.log(
                `   not compared (present on one side only): ${comparison.unmatched.join(', ')}`
            );
        }

        console.log('');
        console.log(
            `   ${comparison.regressionCount} regression(s), ${comparison.suspectCount} suspect(s)`
        );
        console.log('');
    }

    private static verdictMark(
        verdict: TCNSBenchComparison['entries'][number]['verdict']
    ): string {
        switch (verdict) {
            case 'regression':
                return 'REGRESSION';
            case 'suspect':
                return 'suspect   ';
            case 'improvement':
                return 'faster    ';
            case 'skipped':
                return 'skipped   ';
            default:
                return '          ';
        }
    }

    /** Nanoseconds, rendered in whatever unit keeps three or four significant digits. */
    private static duration(nanoseconds: number): string {
        if (!Number.isFinite(nanoseconds)) return '—';
        if (nanoseconds < 1_000) return `${nanoseconds.toFixed(1)}ns`;
        if (nanoseconds < 1_000_000)
            return `${(nanoseconds / 1_000).toFixed(2)}µs`;
        return `${(nanoseconds / 1_000_000).toFixed(2)}ms`;
    }

    /** Byte counts, rendered so a per-hop allocation stays readable. */
    private static bytes(value: number): string {
        if (!Number.isFinite(value)) return '—';
        if (Math.abs(value) < 10_000) return `${value.toFixed(0)}B`;
        if (Math.abs(value) < 10_000_000)
            return `${(value / 1024).toFixed(1)}KB`;
        return `${(value / (1024 * 1024)).toFixed(1)}MB`;
    }

    private static integer(value: number): string {
        if (!Number.isFinite(value)) return '—';
        return Math.round(value).toLocaleString('en-US');
    }

    private static number(value: number): string {
        if (!Number.isFinite(value)) return '—';
        if (Math.abs(value) >= 1000) return CNSBenchReporter.integer(value);
        return value.toFixed(3);
    }
}
