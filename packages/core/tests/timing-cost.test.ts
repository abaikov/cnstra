import { CNS, collateral, neuron } from '../src';
import type { TCNSStimulationResponse } from '@cnstra/types';

/**
 * The engine measures each activation, but only when something will read the
 * measurement. `startedAt` and the `Date.now()` that turns it into a duration
 * escape solely into the response object, and that object is built only when a
 * listener exists — so an unobserved run must not pay for either.
 *
 * Counted, not timed: the assertion is how many times the clock is read, which
 * is the same on every machine.
 */

const chain = (hops: number) => {
    const collaterals = Array.from({ length: hops + 1 }, () =>
        collateral<{ n: number }>()
    );
    const neurons = collaterals.slice(0, hops).map((input, index) => {
        const out = collaterals[index + 1]!;
        return neuron({ out }).dendrite({
            collateral: input,
            response: (p, axon) => axon.out.createSignal({ n: p!.n + 1 }),
        });
    });
    return { cns: new CNS(neurons), entry: collaterals[0]! };
};

/** Run `body` with the clock counted rather than advanced. */
const countingClock = async (body: () => Promise<void>): Promise<number> => {
    const real = Date.now;
    let reads = 0;
    Date.now = () => {
        reads++;
        return real.call(Date);
    };
    try {
        await body();
    } finally {
        Date.now = real;
    }
    return reads;
};

describe('the cost of measuring an activation', () => {
    it('does not read the clock at all when nothing observes the run', async () => {
        const flow = chain(16);

        const reads = await countingClock(async () => {
            await flow.cns
                .stimulate(flow.entry.createSignal({ n: 0 }))
                .waitUntilComplete();
        });

        expect(reads).toBe(0);
    });

    it('does not grow its clock reads with the length of an unobserved run', async () => {
        const short = chain(4);
        const long = chain(64);

        const shortReads = await countingClock(async () => {
            await short.cns
                .stimulate(short.entry.createSignal({ n: 0 }))
                .waitUntilComplete();
        });
        const longReads = await countingClock(async () => {
            await long.cns
                .stimulate(long.entry.createSignal({ n: 0 }))
                .waitUntilComplete();
        });

        expect(longReads).toBe(shortReads);
    });

    it('still measures every activation when a listener is attached', async () => {
        // The saving must not cost the measurement where it is wanted.
        const flow = chain(8);
        const measured: { startedAt?: number; duration?: number }[] = [];

        await flow.cns
            .stimulate(flow.entry.createSignal({ n: 0 }), {
                onResponse: (response: TCNSStimulationResponse) => {
                    if (response.neuron)
                        measured.push({
                            startedAt: response.startedAt,
                            duration: response.duration,
                        });
                },
            })
            .waitUntilComplete();

        expect(measured).toHaveLength(8);
        for (const m of measured) {
            expect(typeof m.startedAt).toBe('number');
            expect(typeof m.duration).toBe('number');
        }
    });

    it('measures an activation that threw, too', async () => {
        const input = collateral<{ n: number }>();
        const boom = neuron({}).dendrite({
            collateral: input,
            response: () => {
                throw new Error('boom');
            },
        });
        const seen: (number | undefined)[] = [];

        await new CNS([boom])
            .stimulate(input.createSignal({ n: 0 }), {
                onResponse: (response: TCNSStimulationResponse) => {
                    if (response.neuron) seen.push(response.duration);
                },
            })
            .waitUntilComplete()
            .catch(() => undefined);

        expect(seen).toHaveLength(1);
        expect(typeof seen[0]).toBe('number');
    });
});
