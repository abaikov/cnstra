import { CNS, cnsCollateral, cnsNeuron } from '../src';
import type { TCNSStimulationResponse } from '@cnstra/types';

/**
 * A response listener can attach data to the activations a response is about to
 * create, and the dendrite reads it back. That works because the engine builds
 * those tasks BEFORE handing the response to the listener, and enqueues those
 * very objects afterwards — so the listener is always in time.
 *
 * These pin the window: what the listener writes, what the dendrite sees, and the
 * three enqueue paths it has to survive.
 */

describe('activationContext', () => {
    it('reaches the activation the listener wrote it on', async () => {
        const input = cnsCollateral<{ id: number }>();
        const out = cnsCollateral<{ ok: boolean }>();
        const seen: unknown[] = [];

        const worker = cnsNeuron({ out }).dendrite({
            collateral: input,
            response: (_p, axon, ctx: any) => {
                seen.push(ctx.activationContext);
                return axon.out.createSignal({ ok: true });
            },
        });

        const cns = new CNS([worker]);
        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: (r: TCNSStimulationResponse) => {
                    for (const task of r.scheduledActivationTasks ?? [])
                        (task.activationContext ??= {})['test'] = { hop: 1 };
                },
            })
            .waitUntilComplete();

        expect(seen).toEqual([{ test: { hop: 1 } }]);
    });

    it('is per activation, not per signal', async () => {
        // One signal wakes two subscribers: two activations, two stores.
        const input = cnsCollateral<{ id: number }>();
        const out = cnsCollateral<{ ok: boolean }>();
        const seen: Record<string, unknown> = {};

        const producer = cnsNeuron({ out }).dendrite({
            collateral: input,
            response: (_p, axon) => axon.out.createSignal({ ok: true }),
        });
        const a = cnsNeuron({}).dendrite({
            collateral: out,
            response: (_p, _axon, ctx: any) => {
                seen.a = ctx.activationContext?.['test'];
            },
        });
        const b = cnsNeuron({}).dendrite({
            collateral: out,
            response: (_p, _axon, ctx: any) => {
                seen.b = ctx.activationContext?.['test'];
            },
        });

        const cns = new CNS([producer, a, b]);
        let n = 0;
        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: (r: TCNSStimulationResponse) => {
                    for (const task of r.scheduledActivationTasks ?? [])
                        (task.activationContext ??= {})['test'] = n++;
                },
            })
            .waitUntilComplete();

        // Distinct values, so neither activation read the other's store.
        expect(seen.a).not.toBe(seen.b);
        expect([seen.a, seen.b].sort()).toEqual([1, 2]);
    });

    it('an async listener is still in time', async () => {
        // The engine waits for a listener's promise before enqueuing, so a
        // listener that awaits before writing has not missed its window.
        const input = cnsCollateral<{ id: number }>();
        let seen: unknown;

        const worker = cnsNeuron({}).dendrite({
            collateral: input,
            response: (_p, _axon, ctx: any) => {
                seen = ctx.activationContext?.['late'];
            },
        });

        const cns = new CNS([worker]);
        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: async (r: TCNSStimulationResponse) => {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    for (const task of r.scheduledActivationTasks ?? [])
                        (task.activationContext ??= {})['late'] = 'written';
                },
            })
            .waitUntilComplete();

        expect(seen).toBe('written');
    });

    it('survives a listener that throws', async () => {
        // The engine enqueues the same tasks from the catch path too.
        const input = cnsCollateral<{ id: number }>();
        let seen: unknown;

        const worker = cnsNeuron({}).dendrite({
            collateral: input,
            response: (_p, _axon, ctx: any) => {
                seen = ctx.activationContext?.['test'];
            },
        });

        const cns = new CNS([worker]);
        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: (r: TCNSStimulationResponse) => {
                    for (const task of r.scheduledActivationTasks ?? [])
                        (task.activationContext ??= {})['test'] = 'written';
                    throw new Error('listener blew up');
                },
            })
            .waitUntilComplete()
            .catch(() => undefined);

        expect(seen).toBe('written');
    });

    it('is undefined when nobody wrote anything', async () => {
        const input = cnsCollateral<{ id: number }>();
        let seen: unknown = 'untouched';

        const worker = cnsNeuron({}).dendrite({
            collateral: input,
            response: (_p, _axon, ctx: any) => {
                seen = ctx.activationContext;
            },
        });

        const cns = new CNS([worker]);
        await cns
            .stimulate(input.createSignal({ id: 1 }))
            .waitUntilComplete();

        // Nothing is allocated for a run that attaches nothing.
        expect(seen).toBeUndefined();
    });

    it('hands the listener the tasks that actually run', async () => {
        const input = cnsCollateral<{ id: number }>();
        const out = cnsCollateral<{ ok: boolean }>();
        const scheduled: object[] = [];
        const ran: object[] = [];

        const producer = cnsNeuron({ out }).dendrite({
            collateral: input,
            response: (_p, axon) => axon.out.createSignal({ ok: true }),
        });
        const worker = cnsNeuron({}).dendrite({
            collateral: out,
            response: (_p, _axon, ctx: any) => {
                ran.push(ctx.activationContext);
            },
        });

        const cns = new CNS([producer, worker]);
        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: (r: TCNSStimulationResponse) => {
                    for (const task of r.scheduledActivationTasks ?? []) {
                        const store = (task.activationContext ??= {});
                        scheduled.push(store);
                    }
                },
            })
            .waitUntilComplete();

        // The store the dendrite read is the SAME object the listener stamped —
        // the engine did not rebuild the task in between.
        expect(ran).toHaveLength(1);
        expect(scheduled).toContain(ran[0]);
    });

    it('is empty on a response that starts nothing', async () => {
        const input = cnsCollateral<{ id: number }>();
        const counts: number[] = [];

        const sink = cnsNeuron({}).dendrite({
            collateral: input,
            response: () => undefined,
        });

        const cns = new CNS([sink]);
        await cns
            .stimulate(input.createSignal({ id: 1 }), {
                onResponse: (r: TCNSStimulationResponse) => {
                    counts.push(r.scheduledActivationTasks?.length ?? -1);
                },
            })
            .waitUntilComplete();

        // Entry injection schedules the sink; the sink itself schedules nothing.
        expect(counts).toEqual([1, 0]);
    });
});
