import type { TCNSBenchCaseResult } from './TCNSBenchCaseResult';
import type { TCNSBenchMachineInfo } from './TCNSBenchMachineInfo';
import type { TCNSBenchRatio } from './TCNSBenchRatio';
import type { TCNSBenchRunnerOptions } from './TCNSBenchRunnerOptions';
import type { TCNSBenchScaling } from './TCNSBenchScaling';

/**
 * One complete run: the numbers, and everything needed to know whether they may
 * be compared with somebody else's.
 *
 * This is also the on-disk baseline format — a baseline is just a report that
 * was kept.
 */
export type TCNSBenchReport = {
    /** Bumped when the shape changes; the comparator refuses a shape it cannot read. */
    schemaVersion: 2;
    createdAt: string;
    machine: TCNSBenchMachineInfo;
    options: TCNSBenchRunnerOptions;
    /** Absolute per-operation timings. Machine-bound. */
    cases: TCNSBenchCaseResult[];
    /** Prices of options as multiples. Travel between machines. */
    ratios: TCNSBenchRatio[];
    /** Fitted growth exponents. Travel between machines. */
    scalings: TCNSBenchScaling[];
    /**
     * How far each metric moved between the repeated runs this recording was
     * made from — see {@link CNSBenchSpread}. Empty for a single run, which is
     * why `bench:baseline` records several: without it the comparator has no
     * honest idea what "unchanged" looks like for a given case and falls back to
     * one flat number for all of them.
     */
    spread: Record<string, number>;
};
