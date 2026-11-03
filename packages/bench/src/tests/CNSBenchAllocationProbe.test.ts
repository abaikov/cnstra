import { CNSBenchAllocationProbe } from '../CNSBenchAllocationProbe';
import { CNSEngineBenchSuite } from '../suites/CNSEngineBenchSuite';

/**
 * The probe's job is a number that means the same thing twice. The estimator it
 * replaced could not do that: `engine/linear-chain-8` read 44% apart across
 * three runs of identical code — because it took the MAXIMUM over shrinking
 * windows, and the window that happened to catch a foreign allocation won.
 *
 * So the properties tested here are reproducibility and honesty about the fixed
 * per-window cost, not an exact byte count. An exact expectation would be a test
 * of V8's object layout, which is not what the gate reads.
 */

jest.setTimeout(60_000);

/**
 * Retains what each operation allocates, so no collection can hide it.
 *
 * A PLAIN array, deliberately. A `Float64Array`'s payload is external memory and
 * `heapUsed` does not report it at all — the first version of this fixture used
 * one and the probe correctly answered that 256 operations had allocated 66 kB
 * rather than a megabyte. A packed double array lives on the JS heap, eight
 * bytes an element plus a header.
 */
const holder = (perOperationBytes: number) => {
    const elements = Math.max(1, Math.round(perOperationBytes / 8));
    const kept: number[][] = [];
    return {
        run: () => {
            const buffer = new Array<number>(elements).fill(1);
            buffer[0] = kept.length;
            kept.push(buffer);
            return undefined;
        },
        release: () => {
            kept.length = 0;
        },
    };
};

describe('CNSBenchAllocationProbe', () => {
    it('answers within a few percent of what an operation retains', async () => {
        const subject = holder(8_000);
        try {
            const result = await CNSBenchAllocationProbe.measure(
                subject.run,
                512
            );

            expect(result.exact).toBe(true);
            // The payload is the floor; the array header is real but small.
            expect(result.bytesPerOperation).toBeGreaterThan(8_000 * 0.95);
            expect(result.bytesPerOperation).toBeLessThan(8_000 * 1.2);
        } finally {
            subject.release();
        }
    });

    it('gives the same answer twice', async () => {
        // THE defect: two probes of the same operation must not disagree the way
        // two runs of the suite did.
        const subject = holder(4_000);
        try {
            const first = await CNSBenchAllocationProbe.measure(subject.run, 512);
            const second = await CNSBenchAllocationProbe.measure(
                subject.run,
                512
            );

            expect(first.exact && second.exact).toBe(true);
            const apart =
                Math.abs(first.bytesPerOperation - second.bytesPerOperation) /
                Math.min(first.bytesPerOperation, second.bytesPerOperation);
            // Nine pairs reproduced the median to 1.7% over five probes when
            // this was measured; five points of room for a loaded machine.
            expect(apart).toBeLessThan(0.05);
        } finally {
            subject.release();
        }
    });

    it('does not charge the window its own overhead', async () => {
        // The slope's whole purpose. Measured at two budgets that differ eight
        // times over: a per-window constant divided by operations would show up
        // as the small budget reading higher.
        const subject = holder(2_000);
        try {
            const narrow = await CNSBenchAllocationProbe.measure(
                subject.run,
                64
            );
            const wide = await CNSBenchAllocationProbe.measure(
                subject.run,
                512
            );

            expect(narrow.exact && wide.exact).toBe(true);
            const apart =
                Math.abs(narrow.bytesPerOperation - wide.bytesPerOperation) /
                wide.bytesPerOperation;
            expect(apart).toBeLessThan(0.1);
        } finally {
            subject.release();
        }
    });

    it('gives the same answer whatever budget it is given', async () => {
        // THE defect underneath the estimator, and the one that made `exact`
        // meaningless. Collector entries arrive only after a macrotask turn, so
        // a single `setImmediate` saw zero collections in EVERY window — and a
        // window big enough to collect then reported what survived it rather
        // than what was allocated.
        //
        // It takes a real case to show: a synthetic body that allocates the same
        // amount every call has the freed fraction cancel in the slope, and the
        // answer comes out right even from dirty windows. `engine/linear-chain-64`
        // does not — under the old settle it read 21523 B/op up to budget 4096
        // and 5144 at 8192, four times apart, both marked exact. (Standalone,
        // outside jest, the cliff falls at 1024: 19417 against 3054. The budget
        // where the collector first slips past depends on the host's own heap
        // pressure, so the sweep has to span a wide range.)
        const benchCase = CNSEngineBenchSuite.create().cases.find(
            c => c.id === 'engine/linear-chain-64'
        )!;
        const body = await benchCase.prepare();
        try {
            for (let i = 0; i < 2_000; i++) {
                const pending = body.run();
                if (pending) await pending;
            }

            const answers = [];
            for (const budget of [128, 1024, 8192]) {
                answers.push(
                    await CNSBenchAllocationProbe.measure(body.run, budget)
                );
            }

            const values = answers
                .filter(a => a.exact)
                .map(a => a.bytesPerOperation);
            expect(values.length).toBe(answers.length);
            const apart =
                (Math.max(...values) - Math.min(...values)) /
                Math.min(...values);
            expect(apart).toBeLessThan(0.1);
        } finally {
            await body.teardown?.();
        }
    });

    it('reports the operations it measured over', async () => {
        const subject = holder(1_000);
        try {
            const result = await CNSBenchAllocationProbe.measure(
                subject.run,
                256
            );
            // The larger half of the pair, which is the budget it was given.
            expect(result.operations).toBeGreaterThan(0);
            expect(result.operations).toBeLessThanOrEqual(256);
        } finally {
            subject.release();
        }
    });
});
