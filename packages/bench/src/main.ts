/**
 * Command line entry point.
 *
 *   tsx src/main.ts run       [options]   measure, print
 *   tsx src/main.ts baseline  [options]   measure, print, and keep the result
 *   tsx src/main.ts compare   [options]   measure, print, read against a baseline
 *
 * A script, so the repository's one-export-per-file rule does not apply here;
 * this is argument parsing and wiring, not architecture.
 */

import { CNSBenchBaselineStore } from './CNSBenchBaselineStore';
import { CNSBenchComparator } from './CNSBenchComparator';
import { CNSBenchReporter } from './CNSBenchReporter';
import { CNSBenchRunner } from './CNSBenchRunner';
import { CNSBenchSpread } from './CNSBenchSpread';
import { CNSEngineBenchSuite } from './suites/CNSEngineBenchSuite';
import { CNSFrontierBenchSuite } from './suites/CNSFrontierBenchSuite';
import { CNSObservationBenchSuite } from './suites/CNSObservationBenchSuite';
import { CNSRosterBenchSuite } from './suites/CNSRosterBenchSuite';
import type { TCNSBenchReport } from './types/TCNSBenchReport';
import type { TCNSBenchRunnerOptions } from './types/TCNSBenchRunnerOptions';
import type { TCNSBenchSuite } from './types/TCNSBenchSuite';
import type { TCNSBenchTolerances } from './types/TCNSBenchTolerances';

const USAGE = `
CNStra benchmarks

  tsx src/main.ts <command> [options]

Commands
  run                 measure and print (default)
  baseline            measure, print, and write the result as this machine's baseline
  compare             measure, print, and read the result against a baseline

Options
  --filter <text>     only cases whose id contains <text> (comma-separated for several)
  --repeat <n>        whole-suite runs to record a baseline from (default 3, baseline only);
                      the run-to-run spread across them is what every threshold is widened by
  --samples <n>       timed samples per case (default 40)
  --warmup-ms <n>     untimed warmup per case (default 400)
  --min-sample-ms <n> target duration of one sample; sets the batch size (default 2)
  --max-batch <n>     cap on the calibrated batch size (default 200000)
  --alloc-ops <n>     cap on operations per allocation probe window (default 4096)
  --gc                collect between cases (needs node --expose-gc)
  --json <path>       also write the raw report as JSON
  --baseline <path>   read/write this file instead of baselines/<machine>.json
  --check             exit 1 if the comparison finds a regression
  --tolerance-case <percent>     absolute timing tolerance (default 25)
  --tolerance-ratio <percent>    option-cost tolerance (default 20)
  --tolerance-alloc <percent>    bytes-per-operation tolerance (default 10)
  --tolerance-scaling <units>    growth-exponent tolerance (default 0.25)
  --help

Examples
  npm run bench                                    (from the repository root)
  npm run bench:baseline
  npm run bench --workspace=@cnstra/bench -- --filter roster
  npm run bench:compare --workspace=@cnstra/bench -- --check
  node --expose-gc --import tsx src/main.ts run --gc
`;

type TArguments = {
    command: 'run' | 'baseline' | 'compare';
    filters: string[];
    jsonPath?: string;
    baselinePath?: string;
    check: boolean;
    /** Whole-suite repetitions. Only a baseline uses more than one. */
    repeat: number;
    runner: TCNSBenchRunnerOptions;
    tolerances: TCNSBenchTolerances;
};

const parseArguments = (argv: string[]): TArguments => {
    // Only the FIRST token can be the command. Scanning for any non-flag token
    // would pick up an option's value — `--filter roster` would be read as a
    // command called "roster".
    const first = argv[0];
    const command = (
        first && !first.startsWith('-') ? first : 'run'
    ) as TArguments['command'];
    if (!['run', 'baseline', 'compare'].includes(command)) {
        throw new Error(`unknown command "${command}"`);
    }

    const valueOf = (name: string): string | undefined => {
        const index = argv.indexOf(`--${name}`);
        if (index < 0) return undefined;
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`--${name} needs a value`);
        }
        return value;
    };
    const numberOf = (name: string, fallback: number): number => {
        const raw = valueOf(name);
        if (raw === undefined) return fallback;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
            throw new Error(`--${name} must be a number, got "${raw}"`);
        }
        return parsed;
    };

    const defaults = CNSBenchComparator.defaultTolerances;
    return {
        command,
        filters: (valueOf('filter') ?? '')
            .split(',')
            .map(token => token.trim())
            .filter(token => token.length > 0),
        jsonPath: valueOf('json'),
        baselinePath: valueOf('baseline'),
        check: argv.includes('--check'),
        // Three is the smallest count that gives a range rather than a
        // difference, and the whole suite takes a couple of minutes.
        repeat:
            command === 'baseline'
                ? Math.max(1, Math.floor(numberOf('repeat', 3)))
                : 1,
        runner: {
            samples: numberOf('samples', 40),
            warmupMs: numberOf('warmup-ms', 400),
            minSampleMs: numberOf('min-sample-ms', 2),
            maxBatchSize: numberOf('max-batch', 200_000),
            allocationOperations: numberOf('alloc-ops', 4096),
            forceGc: argv.includes('--gc'),
        },
        tolerances: {
            casePercent: numberOf('tolerance-case', defaults.casePercent),
            ratioPercent: numberOf('tolerance-ratio', defaults.ratioPercent),
            allocationPercent: numberOf(
                'tolerance-alloc',
                defaults.allocationPercent
            ),
            scalingExponent: numberOf(
                'tolerance-scaling',
                defaults.scalingExponent
            ),
        },
    };
};

/**
 * Keep only the cases the filter asks for — but keep any case another kept case
 * is measured AGAINST as well. Dropping a `relativeTo` target would silently
 * delete the ratio, which is the metric most worth keeping.
 */
const applyFilter = (
    suites: TCNSBenchSuite[],
    filters: string[]
): TCNSBenchSuite[] => {
    if (filters.length === 0) return suites;
    const matches = (id: string): boolean =>
        filters.some(filter => id.includes(filter));

    const required = new Set<string>();
    for (const suite of suites) {
        for (const benchCase of suite.cases) {
            if (!matches(benchCase.id)) continue;
            required.add(benchCase.id);
            if (benchCase.relativeTo) required.add(benchCase.relativeTo);
        }
    }

    return suites
        .map(suite => ({
            ...suite,
            cases: suite.cases.filter(benchCase => required.has(benchCase.id)),
        }))
        .filter(suite => suite.cases.length > 0);
};

const main = async (): Promise<number> => {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(USAGE);
        return 0;
    }

    const args = parseArguments(argv);
    const suites = applyFilter(
        [
            CNSEngineBenchSuite.create(),
            CNSObservationBenchSuite.create(),
            CNSFrontierBenchSuite.create(),
            CNSRosterBenchSuite.create(),
        ],
        args.filters
    );

    if (suites.length === 0) {
        console.error(
            `[bench] no case matched --filter ${args.filters.join(',')}`
        );
        return 1;
    }

    if (args.runner.forceGc && typeof (globalThis as { gc?: unknown }).gc !== 'function') {
        console.warn(
            '[bench] --gc was passed but globalThis.gc is missing; run node with --expose-gc to use it'
        );
    }

    const totalCases = suites.reduce((sum, suite) => sum + suite.cases.length, 0);
    const runner = new CNSBenchRunner(args.runner);
    const runs: TCNSBenchReport[] = [];
    // EVERY command throws the first whole-suite pass away, and the reason is
    // not noise. Each case's own warmup settles its timings, but not the tier
    // V8 compiles it to across a whole suite: `engine/linear-chain-64`
    // allocates 19420 bytes an operation on the first pass and 23005 on the
    // second and third, from the same probe window, both exact.
    //
    // It has to be every command, not just `baseline`. A baseline recorded from
    // later passes and compared against a single-pass run puts two different
    // compilation states side by side, and every engine allocation then reads
    // 25–32% "faster" forever — which is exactly what happened when only the
    // baseline discarded it.
    const passes = args.repeat + 1;
    for (let pass = 0; pass < passes; pass++) {
        let done = 0;
        process.stderr.write(
            pass === 0
                ? '  warmup run (discarded)\n'
                : args.repeat > 1
                ? `  run ${pass} of ${args.repeat}\n`
                : '  measured run\n'
        );
        const run = await runner.run(suites, result => {
            done++;
            process.stderr.write(`  [${done}/${totalCases}] ${result.id}\n`);
        });
        if (pass > 0) runs.push(run);
    }

    // The LAST run's numbers, with the spread measured across all of them. The
    // last rather than an average: a baseline has to be a set of figures some
    // single process actually produced, or a reader cannot reproduce any of it.
    const report: TCNSBenchReport = {
        ...runs[runs.length - 1],
        spread: CNSBenchSpread.of(runs),
    };

    CNSBenchReporter.printReport(report, suites);
    if (args.repeat > 1) CNSBenchReporter.printSpread(report.spread);

    const store = new CNSBenchBaselineStore();
    if (args.jsonPath) {
        store.save(report, args.jsonPath);
        console.log(`report written to ${args.jsonPath}`);
    }

    if (args.command === 'baseline') {
        const written = store.save(report, args.baselinePath);
        console.log(`baseline recorded at ${written}`);
        return 0;
    }

    if (args.command === 'compare') {
        const baseline = store.load(args.baselinePath);
        if (!baseline) {
            console.error(
                `[bench] no baseline at ${args.baselinePath ?? store.pathForThisMachine()} — ` +
                    'record one with "npm run bench:baseline" first'
            );
            return 1;
        }
        const comparison = new CNSBenchComparator(args.tolerances).compare(
            baseline,
            report
        );
        CNSBenchReporter.printComparison(comparison);
        if (args.check && comparison.regressionCount > 0) return 1;
    }

    return 0;
};

main().then(
    code => {
        process.exitCode = code;
    },
    error => {
        console.error(error);
        process.exitCode = 1;
    }
);
