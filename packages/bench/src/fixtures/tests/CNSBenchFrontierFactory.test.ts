import { CNSBenchFrontierFactory } from '.././CNSBenchFrontierFactory';

/**
 * The frontier family varies ONE thing.
 *
 * Each fan-out neuron brings its own collateral into the registry, so a family
 * that only varies the width varies the frontier and the registry together — and
 * the growth exponent it produces mixes the serializer's per-task work with the
 * registry's name lookup. An exponent near two would then not say which half
 * moved. Padding holds the registry constant; this is what checks that it does.
 *
 * No timings here: this is a structural property, and it is checkable exactly.
 */

const registered = (graph: { registry: unknown }): number => {
    const map = (graph.registry as { collaterals?: Map<string, unknown> })
        .collaterals;
    if (!map) throw new Error('the registry no longer keeps collaterals by name');
    return map.size;
};

describe('the frontier fixture', () => {
    it('registers the same number of collaterals at every width', async () => {
        const sizes = await Promise.all(
            [8, 16, 32, 64].map(async width => {
                const frontier = await CNSBenchFrontierFactory.capture(
                    width,
                    64
                );
                return registered(frontier.graph);
            })
        );

        expect(new Set(sizes).size).toBe(1);
    });

    it('still produces a frontier of the width it was asked for', async () => {
        // Padding must not change the thing being measured.
        for (const width of [8, 16, 32, 64]) {
            const frontier = await CNSBenchFrontierFactory.capture(width, 64);
            expect(frontier.taskCount).toBe(width);
        }
    });

    it('varies the registry when the padding is not asked for', async () => {
        // The confound is real, which is why the padding exists.
        const small = await CNSBenchFrontierFactory.capture(8);
        const large = await CNSBenchFrontierFactory.capture(64);

        expect(registered(large.graph)).toBeGreaterThan(
            registered(small.graph)
        );
    });
});
