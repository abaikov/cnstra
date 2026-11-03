import { CNSBenchFrontierFactory } from '../fixtures/CNSBenchFrontierFactory';
import type { TCNSBenchCase } from '../types/TCNSBenchCase';
import type { TCNSBenchSuite } from '../types/TCNSBenchSuite';

/**
 * The resume checkpoint round trip.
 *
 * `CNSProgressSerializer.serialize` runs at every checkpoint of every persisted
 * run — on the debounced cadence normally, and on every single hop when
 * `barrier: true` is on. `hydrate` runs once per resume. Between them they are
 * the whole cost of being resumable, so they are measured apart (to see which
 * half moved) and together (because a checkpoint is the pair plus the JSON,
 * and the JSON is not free).
 *
 * On reading the growth exponent: `n` here is the number of tasks in the
 * frontier, and it is also the number of neurons and collaterals in the graph
 * that produced it, because the two grow together — a wider fan-out is what
 * makes a wider frontier. The exponent therefore covers both the per-task work
 * and however `CNSPersistOptionsRegistry.getCollateralName` scales with the
 * number of registered collaterals (today: it scans them). That is the real
 * cost of a real checkpoint, which is what makes it worth watching; it is not a
 * clean isolation of one variable, and the README says so too.
 */
export class CNSFrontierBenchSuite {
    private static readonly frontierSizes = [8, 16, 32, 64];
    /** The size the absolute hydrate/round-trip cases use. */
    private static readonly referenceSize = 32;
    /**
     * Every case in this file registers this many collaterals, whatever its own
     * frontier width. The registry's name lookup then costs the same in every
     * point of the family, so the growth exponent describes the serializer alone.
     */
    private static readonly registrySize = 64;

    static create(): TCNSBenchSuite {
        return {
            name: 'frontier',
            summary:
                'CNSProgressSerializer — the resume checkpoint taken on every flush',
            cases: [
                ...CNSFrontierBenchSuite.frontierSizes.map(width =>
                    CNSFrontierBenchSuite.serializeCase(width)
                ),
                CNSFrontierBenchSuite.hydrateCase(
                    CNSFrontierBenchSuite.referenceSize
                ),
                CNSFrontierBenchSuite.roundTripCase(
                    CNSFrontierBenchSuite.referenceSize
                ),
            ],
        };
    }

    /** Snapshot a live run's outstanding frontier by registry name. */
    private static serializeCase(width: number): TCNSBenchCase {
        return {
            id: `frontier/serialize-${width}`,
            operation: `one serialize() of a ${width}-task outstanding frontier into a name-keyed progress record`,
            scaling: { family: 'frontier/serialize', n: width },
            prepare: async () => {
                const frontier = await CNSBenchFrontierFactory.capture(
                    width,
                    CNSFrontierBenchSuite.registrySize
                );
                return {
                    run: () => {
                        frontier.serializer.serialize(frontier.stimulation);
                    },
                    verify: () => {
                        const progress = frontier.serializer.serialize(
                            frontier.stimulation
                        );
                        CNSFrontierBenchSuite.assertTaskCount(
                            progress.tasks.length,
                            width,
                            'serialize'
                        );
                    },
                };
            },
        };
    }

    /**
     * Rebuild activation tasks from a stored record.
     *
     * The input is the record AFTER a `JSON.stringify`/`JSON.parse` pair, not
     * the live object the serializer just produced. That matters: what comes
     * back out of a store is a fresh plain object with no shared references and
     * a different hidden-class history, and hydrating the live object instead
     * would quietly measure a case that never happens.
     */
    private static hydrateCase(width: number): TCNSBenchCase {
        return {
            id: `frontier/hydrate-${width}`,
            operation: `one hydrate() of a stored ${width}-task progress record back into activation tasks`,
            prepare: async () => {
                const frontier = await CNSBenchFrontierFactory.capture(
                    width,
                    CNSFrontierBenchSuite.registrySize
                );
                return {
                    run: () => {
                        frontier.serializer.hydrate(frontier.progressJson);
                    },
                    verify: () => {
                        const { tasks } = frontier.serializer.hydrate(
                            frontier.progressJson
                        );
                        CNSFrontierBenchSuite.assertTaskCount(
                            tasks.length,
                            width,
                            'hydrate'
                        );
                    },
                };
            },
        };
    }

    /**
     * The whole checkpoint: serialize, encode to JSON, decode, hydrate.
     *
     * This is what one resume actually costs end to end, and it is the case to
     * read when deciding what a barrier-mode run is paying per hop.
     */
    private static roundTripCase(width: number): TCNSBenchCase {
        return {
            id: `frontier/round-trip-${width}`,
            operation: `one full checkpoint round trip over a ${width}-task frontier: serialize, JSON.stringify, JSON.parse, hydrate`,
            relativeTo: `frontier/serialize-${width}`,
            prepare: async () => {
                const frontier = await CNSBenchFrontierFactory.capture(
                    width,
                    CNSFrontierBenchSuite.registrySize
                );
                const roundTrip = () => {
                    const progress = frontier.serializer.serialize(
                        frontier.stimulation
                    );
                    const stored = JSON.parse(
                        JSON.stringify(progress)
                    ) as typeof progress;
                    return frontier.serializer.hydrate(stored);
                };
                return {
                    run: () => {
                        roundTrip();
                    },
                    verify: () => {
                        CNSFrontierBenchSuite.assertTaskCount(
                            roundTrip().tasks.length,
                            width,
                            'round trip'
                        );
                    },
                };
            },
        };
    }

    private static assertTaskCount(
        actual: number,
        expected: number,
        what: string
    ): void {
        if (actual !== expected) {
            throw new Error(
                `[bench] ${what} produced ${actual} tasks, expected ${expected} — the frontier fixture is not the size it claims`
            );
        }
    }
}
