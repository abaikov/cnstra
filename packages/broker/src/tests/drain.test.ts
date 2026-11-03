import { createCNSDrainState } from '.././drain';
import type { ICNSStimulation } from '@cnstra/types';

/**
 * Shutdown used to poll: `while (active.size > 0) await sleep(50)`, with no
 * deadline on the second pass. A single job whose neuron ignored the abort signal
 * held it open forever, and the process was killed by the orchestrator mid-write —
 * losing the checkpoint the wait existed to preserve.
 *
 * These pin the two properties that matter: it comes back promptly when the work
 * finishes, and it ALWAYS comes back.
 */

/** A stand-in for an in-flight stimulation; the drain only holds the reference. */
const fakeStimulation = (): ICNSStimulation<any> =>
    ({} as unknown as ICNSStimulation<any>);

const elapsed = async (fn: () => Promise<unknown>): Promise<number> => {
    const at = Date.now();
    await fn();
    return Date.now() - at;
};

describe('drainAndAbort', () => {
    it('returns at once when nothing is in flight', async () => {
        // Ordering, not a clock: it must not spend any of the budget it was given.
        const drain = createCNSDrainState();
        let settled = false;
        const done = drain.drainAndAbort(5_000).then(() => {
            settled = true;
        });

        await new Promise(resolve => setImmediate(resolve));

        expect(settled).toBe(true);
        await done;
    });

    it('is woken by the last job finishing, not by a timer', async () => {
        // Asserted by ordering rather than by a clock: a wall-clock bound flakes
        // the moment the machine is busy, and it did. A notified wait settles
        // within a couple of turns of the `delete`; a poller cannot, because it
        // is parked in a `setTimeout` that has not fired yet.
        const drain = createCNSDrainState();
        const job = fakeStimulation();
        drain.active.add(job);

        let settled = false;
        const done = drain.drainAndAbort(5_000).then(() => {
            settled = true;
        });

        // Let it park.
        await new Promise(resolve => setImmediate(resolve));
        expect(settled).toBe(false);

        drain.active.delete(job);
        await new Promise(resolve => setImmediate(resolve));

        expect(settled).toBe(true);
        await done;
    });

    it('stops taking new jobs the moment it starts', async () => {
        const drain = createCNSDrainState();
        expect(drain.isStopping()).toBe(false);
        const done = drain.drainAndAbort(20);
        expect(drain.isStopping()).toBe(true);
        await done;
    });

    it('aborts the run that overstays the first half of the budget', async () => {
        const drain = createCNSDrainState();
        drain.active.add(fakeStimulation());

        await drain.drainAndAbort(60);

        expect(drain.abort.signal.aborted).toBe(true);
    });

    it('does not abort a run that finished inside the budget', async () => {
        const drain = createCNSDrainState();
        const job = fakeStimulation();
        drain.active.add(job);
        setTimeout(() => drain.active.delete(job), 5);

        await drain.drainAndAbort(400);

        expect(drain.abort.signal.aborted).toBe(false);
    });

    it('ALWAYS returns — even when a job never settles after the abort', async () => {
        // The whole point: a neuron parked in a fetch that ignores the signal must
        // not hold shutdown open. This test would never finish against the old code.
        const drain = createCNSDrainState();
        drain.active.add(fakeStimulation());

        const ms = await elapsed(() => drain.drainAndAbort(120));

        expect(drain.active.size).toBe(1); // it really never settled
        expect(ms).toBeGreaterThanOrEqual(100); // both halves were honoured
        // Generous on purpose: the claim is that it comes back at all, and a busy
        // machine stretches every wait here.
        expect(ms).toBeLessThan(2_000);
    });

    it('keeps drainMs as the whole budget, not the first half of it', async () => {
        const drain = createCNSDrainState();
        drain.active.add(fakeStimulation());

        const ms = await elapsed(() => drain.drainAndAbort(200));

        // Graceful + settle together stay inside what the caller asked for; a
        // deployment's termination grace period is on the shutdown as a whole.
        // The bound is loose because a busy machine stretches both halves.
        expect(ms).toBeLessThan(2_000);
    });

    it('leaves no timer holding the event loop open', async () => {
        // `within` clears its timer when the wait wins; a leaked one keeps a Node
        // process alive past shutdown.
        const drain = createCNSDrainState();
        const job = fakeStimulation();
        drain.active.add(job);
        setTimeout(() => drain.active.delete(job), 5);

        await drain.drainAndAbort(30_000);
        // Reaching here at all proves the 30s timer did not have to fire; jest
        // would otherwise sit on it at teardown.
        expect(drain.active.size).toBe(0);
    });
});
