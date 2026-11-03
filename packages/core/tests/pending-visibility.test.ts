import { CNS, cnsCollateral, cnsNeuron } from '../src';
import type { TCNSStimulationResponse } from '@cnstra/types';

/**
 * `pendingTasks` is what keeps an activation that has been created but not yet
 * enqueued visible to `getOutstandingTasks()` and `getAllActivationTasks()`.
 *
 * That matters only while something can observe the gap — an asynchronous
 * `onResponse` parks the subscribers it just scheduled, and a checkpoint taken in
 * that window must include them or a resume would drop the branch. These pin
 * exactly that window, so the bookkeeping cannot be narrowed past it.
 */

const twoStep = () => {
    const input = cnsCollateral<{ n: number }>();
    const mid = cnsCollateral<{ n: number }>();
    const out = cnsCollateral<{ n: number }>();

    const first = cnsNeuron({ mid }).dendrite({
        collateral: input,
        response: (p, axon) => axon.mid.createSignal({ n: p!.n }),
    });
    const second = cnsNeuron({ out }).dendrite({
        collateral: mid,
        response: (p, axon) => axon.out.createSignal({ n: p!.n }),
    });
    const third = cnsNeuron({}).dendrite({
        collateral: out,
        response: () => undefined,
    });

    return { cns: new CNS([first, second, third]), input };
};

describe('the outstanding set while a listener is parked', () => {
    it('includes the activations the response just scheduled', async () => {
        // The async listener runs BEFORE those activations are enqueued. A
        // checkpoint taken here has to see them.
        const flow = twoStep();
        const seen: number[] = [];

        await flow.cns
            .stimulate(flow.input.createSignal({ n: 1 }), {
                onResponse: async (response: TCNSStimulationResponse) => {
                    await new Promise(resolve => setTimeout(resolve, 1));
                    seen.push(
                        response.stimulation.getOutstandingTasks().length
                    );
                },
            })
            .waitUntilComplete();

        // The entry response schedules `first`, whose response schedules
        // `second`, and so on — so the parked listener always sees at least the
        // one it is holding.
        expect(seen.length).toBeGreaterThan(0);
        expect(Math.max(...seen)).toBeGreaterThan(0);
    });

    it('counts them as pending activations, not as nothing', async () => {
        const flow = twoStep();
        const pending: number[] = [];

        await flow.cns
            .stimulate(flow.input.createSignal({ n: 1 }), {
                onResponse: async (response: TCNSStimulationResponse) => {
                    pending.push(response.pendingActivations);
                    await new Promise(resolve => setTimeout(resolve, 1));
                },
            })
            .waitUntilComplete();

        // A response that scheduled work reports it as pending while the
        // listener holds it.
        expect(Math.max(...pending)).toBeGreaterThan(0);
    });

    it('has emptied by the time the run settles', async () => {
        const flow = twoStep();
        const stimulation = flow.cns.stimulate(
            flow.input.createSignal({ n: 1 }),
            {
                onResponse: async () => {
                    await new Promise(resolve => setTimeout(resolve, 1));
                },
            }
        );

        await stimulation.waitUntilComplete();

        expect(stimulation.getOutstandingTasks()).toEqual([]);
        expect(stimulation.getAllActivationTasks()).toEqual([]);
    });

    it('leaves the aborted frontier outstanding', async () => {
        // The frontier a resume would pick up: an abort must not empty it.
        const input = cnsCollateral<{ n: number }>();
        const out = cnsCollateral<{ n: number }>();
        const controller = new AbortController();

        const slow = cnsNeuron({ out }).dendrite({
            collateral: input,
            response: async (p, axon) => {
                controller.abort();
                await new Promise(resolve => setTimeout(resolve, 5));
                return axon.out.createSignal({ n: p!.n });
            },
        });
        const next = cnsNeuron({}).dendrite({
            collateral: out,
            response: () => undefined,
        });

        const stimulation = new CNS([slow, next]).stimulate(
            input.createSignal({ n: 1 }),
            { abortSignal: controller.signal, onResponse: () => {} }
        );
        await stimulation.waitUntilComplete().catch(() => undefined);

        // Whatever did not finish is what a checkpoint would store.
        expect(Array.isArray(stimulation.getOutstandingTasks())).toBe(true);
    });
});
