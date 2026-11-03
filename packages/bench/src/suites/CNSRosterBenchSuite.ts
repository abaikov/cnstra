import { computeCNSRosterFacets, loadCNSRosterEntries } from '../cnstra';
import { CNSBenchRosterFactory } from '../fixtures/CNSBenchRosterFactory';
import type { TCNSBenchCase } from '../types/TCNSBenchCase';
import type { TCNSBenchSuite } from '../types/TCNSBenchSuite';

/**
 * The roster derivation the devtools panel calls on a timer.
 *
 * `loadCNSRosterEntries` is the reference implementation every store that cannot
 * push the query into SQL falls back on — the in-memory store and the devtools
 * server both run it. The panel re-runs it every couple of seconds, over
 * whatever the store has accumulated, which makes its GROWTH the thing that
 * matters rather than its speed at any one size. A derivation that is
 * comfortable at fifty runs and unusable at a thousand is the failure mode, and
 * it is invisible to a benchmark that only measures one size.
 *
 * Hence the scaling family: four sizes, fitted to `time ~ n^k`. The exponent is
 * machine-independent, so it is the one number here that a CI box and a laptop
 * can argue about on equal terms.
 *
 * These cases are far slower per operation than anything else in the package, so
 * they take fewer samples and a shorter warmup. That widens their spread, and
 * the comparator already accounts for spread when it decides what counts as a
 * regression.
 */
export class CNSRosterBenchSuite {
    private static readonly runCounts = [50, 100, 200, 400];
    /** The size the page and facet cases use. */
    private static readonly referenceRuns = 200;
    private static readonly scopeName = 'bench';

    /** Fewer samples: one operation here is milliseconds, not nanoseconds. */
    private static readonly slowCaseSamples = 15;
    private static readonly slowCaseWarmupMs = 200;

    static create(): TCNSBenchSuite {
        return {
            name: 'roster',
            summary:
                'loadCNSRosterEntries over an in-memory store — what the devtools panel re-runs on a timer',
            cases: [
                ...CNSRosterBenchSuite.runCounts.map(runCount =>
                    CNSRosterBenchSuite.loadEntriesCase(runCount)
                ),
                CNSRosterBenchSuite.queryPageCase(
                    CNSRosterBenchSuite.referenceRuns
                ),
                CNSRosterBenchSuite.facetsCase(
                    CNSRosterBenchSuite.referenceRuns
                ),
            ],
        };
    }

    /** The derivation itself: every run enriched with its attempts and neuron names. */
    private static loadEntriesCase(runCount: number): TCNSBenchCase {
        return {
            id: `roster/load-entries-${runCount}`,
            operation: `one loadCNSRosterEntries() over a store of ${runCount} runs (one attempt and ${CNSBenchRosterFactory.tasksPerRun} task rows each)`,
            scaling: { family: 'roster/load-entries', n: runCount },
            samples: CNSRosterBenchSuite.slowCaseSamples,
            warmupMs: CNSRosterBenchSuite.slowCaseWarmupMs,
            prepare: async () => {
                const repository = await CNSBenchRosterFactory.seed(
                    runCount,
                    CNSRosterBenchSuite.scopeName
                );
                const filter = { scopeName: CNSRosterBenchSuite.scopeName };
                return {
                    run: async () => {
                        await loadCNSRosterEntries(repository, filter);
                    },
                    verify: async () => {
                        const entries = await loadCNSRosterEntries(
                            repository,
                            filter
                        );
                        CNSRosterBenchSuite.assertCount(
                            entries.length,
                            runCount,
                            'loadCNSRosterEntries'
                        );
                    },
                };
            },
        };
    }

    /**
     * The call the panel actually makes: derive everything, then take one keyset
     * page off the top. Read against `roster/load-entries-200` it says how much
     * of a page's cost is the paging and how much is the derivation underneath —
     * which, for a store that has to derive the whole set before it can slice
     * it, is the interesting question.
     */
    private static queryPageCase(runCount: number): TCNSBenchCase {
        return {
            id: `roster/query-page-${runCount}`,
            operation: `one repository.queryRoster() returning the first 50-row keyset page from a store of ${runCount} runs`,
            relativeTo: `roster/load-entries-${runCount}`,
            samples: CNSRosterBenchSuite.slowCaseSamples,
            warmupMs: CNSRosterBenchSuite.slowCaseWarmupMs,
            prepare: async () => {
                const repository = await CNSBenchRosterFactory.seed(
                    runCount,
                    CNSRosterBenchSuite.scopeName
                );
                const filter = { scopeName: CNSRosterBenchSuite.scopeName };
                const page = { limit: 50 };
                return {
                    run: async () => {
                        await repository.queryRoster(filter, page);
                    },
                    verify: async () => {
                        const result = await repository.queryRoster(
                            filter,
                            page
                        );
                        CNSRosterBenchSuite.assertCount(
                            result.rows.length,
                            Math.min(page.limit, runCount),
                            'queryRoster page'
                        );
                        CNSRosterBenchSuite.assertCount(
                            result.total,
                            runCount,
                            'queryRoster total'
                        );
                    },
                };
            },
        };
    }

    /**
     * The facet rail and the histogram, over an ALREADY loaded set.
     *
     * Loading is left out on purpose here: `computeCNSRosterFacets` is pure
     * aggregation and is the half a store with real SQL would replace with a
     * `GROUP BY`, so it is worth being able to see it move on its own.
     */
    private static facetsCase(runCount: number): TCNSBenchCase {
        return {
            id: `roster/facets-${runCount}`,
            operation: `one computeCNSRosterFacets() over ${runCount} already-loaded roster entries (status, entry collateral, neuron and time buckets)`,
            prepare: async () => {
                const repository = await CNSBenchRosterFactory.seed(
                    runCount,
                    CNSRosterBenchSuite.scopeName
                );
                const entries = await loadCNSRosterEntries(repository, {
                    scopeName: CNSRosterBenchSuite.scopeName,
                });
                return {
                    run: () => {
                        computeCNSRosterFacets(entries);
                    },
                    verify: () => {
                        const facets = computeCNSRosterFacets(entries);
                        if (
                            facets.byStatus.length === 0 ||
                            facets.byNeuron.length === 0 ||
                            facets.byTime.length === 0
                        ) {
                            throw new Error(
                                '[bench] facets came back empty — the seeded store is not what this case assumes'
                            );
                        }
                    },
                };
            },
        };
    }

    private static assertCount(
        actual: number,
        expected: number,
        what: string
    ): void {
        if (actual !== expected) {
            throw new Error(
                `[bench] ${what} returned ${actual} rows, expected ${expected} — the seeded store is not the size it claims`
            );
        }
    }
}
