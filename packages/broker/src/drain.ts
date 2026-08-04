import type { ICNSStimulation } from '@cnstra/types';

/**
 * Graceful-shutdown state shared by broker workers: an `AbortController`, the set of
 * in-flight stimulations, and a stopping flag. {@link runStimulationJob} adds/removes
 * its stimulation from `active` and reads `stopping` (pass `isStopping()` per job).
 */
export interface TCNSDrainState {
    /** Aborting turns each in-flight stimulation's remaining tasks into its frontier. */
    abort: AbortController;
    /** In-flight stimulations (maintained by {@link runStimulationJob}). */
    active: Set<ICNSStimulation<any>>;
    /** Whether shutdown has begun — reject new jobs so they retry later. */
    isStopping(): boolean;
    /**
     * Stop taking new jobs, let in-flight stimulations finish for up to `drainMs`,
     * then **abort** whatever is still running and wait for the aborted runs to settle
     * (so their frontier checkpoint is written). Does not close the broker itself.
     */
    drainAndAbort(drainMs: number): Promise<void>;
}

export function createDrainState(): TCNSDrainState {
    const abort = new AbortController();
    const active = new Set<ICNSStimulation<any>>();
    let stopping = false;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    return {
        abort,
        active,
        isStopping: () => stopping,
        drainAndAbort: async (drainMs: number) => {
            stopping = true;
            const deadline = Date.now() + drainMs;
            while (active.size > 0 && Date.now() < deadline) await sleep(100);
            if (active.size > 0) abort.abort(); // over the deadline → checkpoint the frontier
            while (active.size > 0) await sleep(50); // let aborted runs settle + persist
        },
    };
}
