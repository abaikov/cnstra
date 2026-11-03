/**
 * The benchmark harness, as a library.
 *
 * The package is private and is normally driven through `src/main.ts`, but the
 * pieces are exported so a one-off investigation can assemble its own cases
 * against the same runner, statistics and comparator rather than hand-rolling a
 * second, differently-wrong timing loop.
 */

export { CNSBenchRunner } from './CNSBenchRunner';
export { CNSBenchAllocationProbe } from './CNSBenchAllocationProbe';
export { CNSBenchStatistics } from './CNSBenchStatistics';
export { CNSBenchSpread } from './CNSBenchSpread';
export { CNSBenchScalingAnalyzer } from './CNSBenchScalingAnalyzer';
export { CNSBenchMachine } from './CNSBenchMachine';
export { CNSBenchBaselineStore } from './CNSBenchBaselineStore';
export { CNSBenchComparator } from './CNSBenchComparator';
export { CNSBenchReporter } from './CNSBenchReporter';

export { CNSBenchGraphFactory } from './fixtures/CNSBenchGraphFactory';
export { CNSBenchFrontierFactory } from './fixtures/CNSBenchFrontierFactory';
export { CNSBenchRosterFactory } from './fixtures/CNSBenchRosterFactory';
export { CNSBenchTracerFactory } from './fixtures/CNSBenchTracerFactory';

export { CNSEngineBenchSuite } from './suites/CNSEngineBenchSuite';
export { CNSObservationBenchSuite } from './suites/CNSObservationBenchSuite';
export { CNSFrontierBenchSuite } from './suites/CNSFrontierBenchSuite';
export { CNSRosterBenchSuite } from './suites/CNSRosterBenchSuite';

export type { TCNSBenchBody } from './types/TCNSBenchBody';
export type { TCNSBenchCase } from './types/TCNSBenchCase';
export type { TCNSBenchCaseResult } from './types/TCNSBenchCaseResult';
export type {
    TCNSBenchComparison,
    TCNSBenchComparisonEntry,
} from './types/TCNSBenchComparison';
export type { TCNSBenchFrontier } from './types/TCNSBenchFrontier';
export type { TCNSBenchGraph } from './types/TCNSBenchGraph';
export type { TCNSBenchMachineInfo } from './types/TCNSBenchMachineInfo';
export type { TCNSBenchPayload } from './types/TCNSBenchPayload';
export type { TCNSBenchRatio } from './types/TCNSBenchRatio';
export type { TCNSBenchReport } from './types/TCNSBenchReport';
export type { TCNSBenchRunnerOptions } from './types/TCNSBenchRunnerOptions';
export type { TCNSBenchScaling } from './types/TCNSBenchScaling';
export type { TCNSBenchSuite } from './types/TCNSBenchSuite';
export type { TCNSBenchTolerances } from './types/TCNSBenchTolerances';
