import { CNS, collateral, neuron } from '../src';

const tick = () => new Promise(r => setTimeout(r, 0));

describe('a hop-limit throw ends the run instead of wedging it', () => {
    // The guard in createSubscriberQueueItem throws while a settled activation
    // is dispatching its subscribers - i.e. deep inside the machinery, not
    // inside a dendrite response (those are caught and recorded as failed tasks).
    // Both tests below used to hang forever: nothing called tryResolveCompleted
    // again, so waitUntilComplete never settled and the error surfaced only as
    // an unhandled rejection. The jest timeout is deliberately short so a
    // regression fails in seconds instead of stalling the suite.

    it('settles when the throw lands in an async continuation', async () => {
        const start = collateral<{ hop: number }>();
        const aToB = collateral<{ hop: number }>();
        const bToA = collateral<{ hop: number }>();

        const a = neuron({ aToB })
            .dendrite({
                collateral: start,
                response: async (p, axon) => {
                    await tick();
                    return axon.aToB.createSignal({ hop: p!.hop + 1 });
                },
            })
            .dendrite({
                collateral: bToA,
                response: async (p, axon) => {
                    await tick();
                    return axon.aToB.createSignal({ hop: p!.hop + 1 });
                },
            });

        const b = neuron({ bToA }).dendrite({
            collateral: aToB,
            response: async (p, axon) => {
                await tick();
                return axon.bToA.createSignal({ hop: p!.hop + 1 });
            },
        });

        const cns = new CNS([a, b]);
        const stimulation = cns.stimulate(start.createSignal({ hop: 0 }), {
            maxNeuronHops: 2,
        });

        await expect(stimulation.waitUntilComplete()).rejects.toThrow(
            /Max neuron hops/
        );
    }, 3000);

    it('settles when the throw unwinds out of the pump loop', async () => {
        // Same cycle, but B is synchronous: its continuation runs inside the
        // pump's while loop, so the throw escapes past `pumping = false`. The
        // flag stayed set forever and every later enqueue took the "already
        // pumping" branch.
        const start = collateral<{ hop: number }>();
        const aToB = collateral<{ hop: number }>();
        const bToA = collateral<{ hop: number }>();

        const a = neuron({ aToB })
            .dendrite({
                collateral: start,
                response: async (p, axon) => {
                    await tick();
                    return axon.aToB.createSignal({ hop: p!.hop + 1 });
                },
            })
            .dendrite({
                collateral: bToA,
                response: async (p, axon) => {
                    await tick();
                    return axon.aToB.createSignal({ hop: p!.hop + 1 });
                },
            });

        const b = neuron({ bToA }).dendrite({
            collateral: aToB,
            response: (p, axon) => axon.bToA.createSignal({ hop: p!.hop + 1 }),
        });

        const cns = new CNS([a, b]);
        const stimulation = cns.stimulate(start.createSignal({ hop: 0 }), {
            maxNeuronHops: 2,
        });

        await expect(stimulation.waitUntilComplete()).rejects.toThrow(
            /Max neuron hops/
        );
    }, 3000);
});

describe('the outstanding frontier after an abort', () => {
    it('lists every queued task exactly once, never twice', async () => {
        // Aborting marks the still-queued tasks as failed WITHOUT dequeuing
        // them, so each one is both in the ring buffer and in failedTasks.
        // Concatenating the two sources handed the broker a resume checkpoint
        // with the whole frontier listed twice - every one of those tasks then
        // ran a second time on the retry.
        const input = collateral<{ id: number }>();
        const mid = collateral<{ id: number }>();
        const controller = new AbortController();

        const slow = neuron({ mid }).dendrite({
            collateral: input,
            response: async (p, axon) => {
                await new Promise(r => setTimeout(r, 30));
                return axon.mid.createSignal({ id: p!.id });
            },
        });
        const leafOne = neuron({}).dendrite({
            collateral: mid,
            response: () => undefined,
        });
        const leafTwo = neuron({}).dendrite({
            collateral: mid,
            response: () => undefined,
        });
        const leafThree = neuron({}).dendrite({
            collateral: mid,
            response: () => undefined,
        });

        const cns = new CNS([slow, leafOne, leafTwo, leafThree]);
        const stimulation = cns.stimulate(input.createSignal({ id: 1 }), {
            abortSignal: controller.signal,
        });

        // Abort while `slow` is still running: its three subscribers are then
        // enqueued but never allowed to start.
        await new Promise(r => setTimeout(r, 5));
        controller.abort();
        await stimulation.waitUntilComplete().catch(() => {});

        // The three leaves are the whole frontier, and they were counted twice.
        expect(stimulation.getFailedTasks()).toHaveLength(3);

        const outstanding = stimulation.getOutstandingTasks();
        expect(new Set(outstanding).size).toBe(outstanding.length);
        expect(outstanding).toHaveLength(3);
    });
});
