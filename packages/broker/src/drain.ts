import type { ICNSStimulation } from '@cnstra/types';

/**
 * The in-flight set, with a way to await it emptying.
 *
 * A plain `Set` cannot say when it empties, and shutdown has to know. `delete` is
 * the only moment it can happen, so that is where the waiters are woken — no
 * polling, and the caller keeps a deadline of its own.
 */
class CNSActiveStimulations extends Set<ICNSStimulation<any>> {
    private waiters: (() => void)[] = [];

    override delete(stimulation: ICNSStimulation<any>): boolean {
        const removed = super.delete(stimulation);
        if (removed && this.size === 0) {
            const waiting = this.waiters;
            this.waiters = [];
            for (const wake of waiting) wake();
        }
        return removed;
    }

    /** Resolves when nothing is in flight — at once if that is already true. */
    whenEmpty(): Promise<void> {
        if (this.size === 0) return Promise.resolve();
        return new Promise<void>(resolve => this.waiters.push(resolve));
    }
}

/** `promise`, but give up after `ms`. The timer is cleared either way. */
function within(promise: Promise<void>, ms: number): Promise<void> {
    return new Promise<void>(resolve => {
        const timer = setTimeout(resolve, ms);
        void promise.then(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/**
 * Graceful-shutdown state shared by broker workers: an `AbortController`, the set of
 * in-flight stimulations, and a stopping flag. {@link runCNSStimulationJob} adds/removes
 * its stimulation from `active` and reads `stopping` (pass `isStopping()` per job).
 */
export type TCNSDrainState = {
    /** Aborting turns each in-flight stimulation's remaining tasks into its frontier. */
    abort: AbortController;
    /** In-flight stimulations (maintained by {@link runCNSStimulationJob}). */
    active: Set<ICNSStimulation<any>>;
    /** Whether shutdown has begun — reject new jobs so they retry later. */
    isStopping(): boolean;
    /**
     * Stop taking new jobs, let in-flight stimulations finish, then **abort** whatever
     * is still running and wait for the aborted runs to settle (so their frontier
     * checkpoint is written). Does not close the broker itself.
     *
     * `drainMs` is the whole budget and a real bound: half is given to finishing on
     * their own, half to settling after the abort. It is split rather than extended
     * because the deadline a deployment sets — a container's termination grace
     * period — is on the shutdown as a whole, and a shutdown that overruns it is
     * killed mid-write.
     */
    drainAndAbort(drainMs: number): Promise<void>;
};

export function createCNSDrainState(): TCNSDrainState {
    const abort = new AbortController();
    const active = new CNSActiveStimulations();
    let stopping = false;

    return {
        abort,
        active,
        isStopping: () => stopping,
        drainAndAbort: async (drainMs: number) => {
            stopping = true;
            const half = Math.max(0, drainMs) / 2;

            await within(active.whenEmpty(), half);
            if (active.size === 0) return;

            // Over the deadline → the remaining tasks become the frontier, and the
            // aborted runs get the other half to write their checkpoint.
            abort.abort();
            await within(active.whenEmpty(), half);
        },
    };
}
