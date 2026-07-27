import {
    CNS,
    collateral,
    neuron,
    neuronFactory,
    withGlobal,
} from '../src/index';
import type { TCNSSignal } from '@cnstra/types';

type TGlobal = { store: { seen: string[] }; now: () => number };

describe('ctx.global (composable factory extension)', () => {
    it('injects the global at createCNS and surfaces it as ctx.global', async () => {
        const ping = collateral<{ id: string }>();
        const done = collateral<{ at: number }>();

        const { neuron: n } = neuronFactory().withGlobal<TGlobal>();

        const worker = n({ done }).bind(
            { ping },
            {
                ping: ({ id }, axon, { global }) => {
                    global.store.seen.push(id);
                    return axon.done.createSignal({ at: global.now() });
                },
            }
        );

        const store = { seen: [] as string[] };
        const cns = new CNS([worker], undefined, { store, now: () => 42 });

        let seenAt: number | undefined;
        await new Promise<void>(resolve => {
            cns.stimulate(ping.createSignal({ id: 'a' }) as TCNSSignal<any>, {
                onResponse: r => {
                    if (r.outputSignal?.collateral === done) {
                        seenAt = (r.outputSignal.payload as { at: number }).at;
                    }
                    if (r.queueLength === 0) resolve();
                },
            });
        });

        expect(store.seen).toEqual(['a']);
        expect(seenAt).toBe(42);
    });

    it('is swappable per instance — same neuron graph, different global', async () => {
        const ping = collateral<{ id: string }>();
        const { neuron: n } = neuronFactory().withGlobal<TGlobal>();

        const worker = n({}).dendrite({
            collateral: ping,
            response: ({ id }, _axon, { global }) => {
                global.store.seen.push(id);
                return undefined;
            },
        });

        const storeA = { seen: [] as string[] };
        const storeB = { seen: [] as string[] };
        const a = { cns: new CNS([worker], undefined, { store: storeA, now: () => 0 }) };
        const b = { cns: new CNS([worker], undefined, { store: storeB, now: () => 0 }) };

        const run = (cns: typeof a.cns, id: string) =>
            new Promise<void>(resolve => {
                cns.stimulate(ping.createSignal({ id }) as TCNSSignal<any>, {
                    onResponse: r => {
                        if (r.queueLength === 0) resolve();
                    },
                });
            });

        await run(a.cns, 'x');
        await run(b.cns, 'y');

        expect(storeA.seen).toEqual(['x']);
        expect(storeB.seen).toEqual(['y']);
    });

    it('base neuron (no withGlobal) has undefined ctx.global at runtime', async () => {
        const ping = collateral<{ id: string }>();

        // No global layer: ctx.global is not in the type; at runtime it reads undefined.
        const worker = neuron({}).dendrite({
            collateral: ping,
            response: (_payload, _axon, ctx) => {
                expect((ctx as { global?: unknown }).global).toBeUndefined();
                return undefined;
            },
        });

        const cns = new CNS([worker]);
        await new Promise<void>(resolve => {
            cns.stimulate(ping.createSignal({ id: 'a' }) as TCNSSignal<any>, {
                onResponse: r => {
                    if (r.queueLength === 0) resolve();
                },
            });
        });
    });
});
