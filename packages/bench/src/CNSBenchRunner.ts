import { CNSBenchAllocationProbe } from './CNSBenchAllocationProbe';
import { CNSBenchMachine } from './CNSBenchMachine';
import { CNSBenchScalingAnalyzer } from './CNSBenchScalingAnalyzer';
import { CNSBenchStatistics } from './CNSBenchStatistics';
import type { TCNSBenchBody } from './types/TCNSBenchBody';
import type { TCNSBenchCase } from './types/TCNSBenchCase';
import type { TCNSBenchCaseResult } from './types/TCNSBenchCaseResult';
import type { TCNSBenchRatio } from './types/TCNSBenchRatio';
import type { TCNSBenchReport } from './types/TCNSBenchReport';
import type { TCNSBenchRunnerOptions } from './types/TCNSBenchRunnerOptions';
import type { TCNSBenchSuite } from './types/TCNSBenchSuite';

/**
 * Times cases and turns them into a report: batches calibrated to `minSampleMs`
 * so clock overhead stays out of the answer, warmup discarded, and a median with
 * an IQR rather than a mean, because a benchmark's outliers are interference.
 *
 * Every case shares one process, so a case can inherit the heap the previous one
 * shaped — one more reason the comparator will not gate on small differences.
 */
export class CNSBenchRunner {
    constructor(private readonly options: TCNSBenchRunnerOptions) {}

    /**
     * Run every case of every suite, in order, and assemble the report.
     *
     * `onCaseComplete` is called as each case finishes so a long run prints
     * something before the end.
     */
    async run(
        suites: TCNSBenchSuite[],
        onCaseComplete?: (result: TCNSBenchCaseResult) => void
    ): Promise<TCNSBenchReport> {
        const cases: TCNSBenchCaseResult[] = [];
        for (const suite of suites) {
            for (const benchCase of suite.cases) {
                const result = await this.runCase(benchCase);
                cases.push(result);
                onCaseComplete?.(result);
            }
        }

        return {
            schemaVersion: 2,
            createdAt: new Date().toISOString(),
            machine: CNSBenchMachine.describe(),
            options: { ...this.options, forceGc: this.canForceGc() },
            cases,
            ratios: CNSBenchRunner.deriveRatios(cases),
            scalings: CNSBenchScalingAnalyzer.analyze(cases),
            // One run cannot know its own run-to-run spread. Whoever records a
            // baseline fills this in from several runs.
            spread: {},
        };
    }

    private async runCase(benchCase: TCNSBenchCase): Promise<TCNSBenchCaseResult> {
        let body: TCNSBenchBody;
        try {
            body = await benchCase.prepare();
        } catch (error) {
            throw new Error(
                `[bench] case "${benchCase.id}" failed while preparing its fixtures`,
                { cause: error }
            );
        }

        try {
            // Proves the body still does the work the case claims. A benchmark
            // that stopped doing anything otherwise reports a huge speed-up.
            await body.verify?.();

            const sampleCount = benchCase.samples ?? this.options.samples;
            const warmupMs = benchCase.warmupMs ?? this.options.warmupMs;

            const batchSize = await this.calibrateBatchSize(body.run);
            await this.warmUp(body.run, batchSize, warmupMs);
            this.collectGarbage();

            const perOperationNs: number[] = [];
            for (let sample = 0; sample < sampleCount; sample++) {
                const elapsedNs = await this.timeBatch(body.run, batchSize);
                perOperationNs.push(elapsedNs / batchSize);
            }

            const sorted = [...perOperationNs].sort((a, b) => a - b);
            const medianNs = CNSBenchStatistics.percentileOfSorted(sorted, 0.5);

            // After the timings, never before: the probe needs a window with no
            // garbage collection in it, and it is far likelier to find one once
            // the heap has settled into the shape this case gives it.
            const allocation = await CNSBenchAllocationProbe.measure(
                body.run,
                Math.min(batchSize, this.options.allocationOperations)
            );

            return {
                id: benchCase.id,
                operation: benchCase.operation,
                ...(benchCase.relativeTo
                    ? { relativeTo: benchCase.relativeTo }
                    : {}),
                ...(benchCase.scaling ? { scaling: benchCase.scaling } : {}),
                batchSize,
                sampleCount,
                measuredOperations: batchSize * sampleCount,
                warmupMs,
                medianNs,
                p25Ns: CNSBenchStatistics.percentileOfSorted(sorted, 0.25),
                p75Ns: CNSBenchStatistics.percentileOfSorted(sorted, 0.75),
                minNs: sorted[0] ?? Number.NaN,
                rmadPercent: CNSBenchStatistics.relativeMedianAbsoluteDeviation(
                    sorted,
                    medianNs
                ),
                opsPerSecond: medianNs > 0 ? 1e9 / medianNs : Number.NaN,
                allocationBytes: allocation.bytesPerOperation,
                allocationOperations: allocation.operations,
                allocationExact: allocation.exact,
            };
        } finally {
            await body.teardown?.();
        }
    }

    /**
     * Time one batch of operations and return the whole batch's nanoseconds.
     *
     * The `if (pending)` is load-bearing: a synchronous body returns
     * `undefined`, so the loop never awaits and never yields to the microtask
     * queue. Awaiting unconditionally would add a microtask turn per operation
     * and swamp exactly the cases that are cheapest.
     */
    private async timeBatch(
        run: TCNSBenchBody['run'],
        batchSize: number
    ): Promise<number> {
        const startedAt = process.hrtime.bigint();
        for (let i = 0; i < batchSize; i++) {
            const pending = run();
            if (pending) await pending;
        }
        return Number(process.hrtime.bigint() - startedAt);
    }

    /**
     * Grow the batch until one sample lasts at least `minSampleMs`.
     *
     * Deliberately overshoots (the 1.2 factor): a batch calibrated while the
     * code is still cold is too small once it is optimised, and a sample that
     * ends up shorter than the target puts clock overhead back into the number.
     */
    private async calibrateBatchSize(
        run: TCNSBenchBody['run']
    ): Promise<number> {
        const targetNs = this.options.minSampleMs * 1e6;
        let batchSize = 1;
        for (let attempt = 0; attempt < 32; attempt++) {
            const elapsedNs = await this.timeBatch(run, batchSize);
            if (elapsedNs >= targetNs || batchSize >= this.options.maxBatchSize) {
                break;
            }
            const growth =
                elapsedNs > 0
                    ? Math.min(Math.max((targetNs / elapsedNs) * 1.2, 2), 16)
                    : 8;
            batchSize = Math.min(
                Math.ceil(batchSize * growth),
                this.options.maxBatchSize
            );
        }
        return batchSize;
    }

    /** Burn the JIT's warmup on batches nobody records. */
    private async warmUp(
        run: TCNSBenchBody['run'],
        batchSize: number,
        warmupMs: number
    ): Promise<void> {
        const deadline = Date.now() + warmupMs;
        do {
            await this.timeBatch(run, batchSize);
        } while (Date.now() < deadline);
    }

    private canForceGc(): boolean {
        return (
            this.options.forceGc &&
            typeof (globalThis as { gc?: () => void }).gc === 'function'
        );
    }

    /**
     * Collect between cases when `--expose-gc` was passed, so one case's garbage
     * is not swept during the next case's samples. Silently skipped otherwise —
     * the flag is a convenience, not a requirement.
     */
    private collectGarbage(): void {
        if (!this.canForceGc()) return;
        (globalThis as { gc?: () => void }).gc?.();
    }

    /**
     * Turn every `relativeTo` link into a ratio.
     *
     * A ratio is the metric that survives a change of machine, so these are what
     * the comparator judges when a baseline came from somewhere else.
     */
    private static deriveRatios(
        results: TCNSBenchCaseResult[]
    ): TCNSBenchRatio[] {
        const byId = new Map(results.map(result => [result.id, result]));
        const ratios: TCNSBenchRatio[] = [];
        for (const result of results) {
            if (!result.relativeTo) continue;
            const base = byId.get(result.relativeTo);
            if (!base || base.medianNs <= 0) continue;
            ratios.push({
                id: result.id,
                baseId: base.id,
                ratio: result.medianNs / base.medianNs,
                noisePercent: Math.max(result.rmadPercent, base.rmadPercent),
            });
        }
        return ratios;
    }
}
