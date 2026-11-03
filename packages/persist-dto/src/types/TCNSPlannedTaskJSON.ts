import type { TCNSContextStore } from '@cnstra/types';
import type { TCNSSignalJSON } from './TCNSSignalJSON';

/**
 * One frontier activation task, serialized by **stable registry names** — no live
 * object references — so it survives a process boundary (queue retry, crash,
 * redeploy). Round-trips through JSON. Self-contained: its `input` is inline, since
 * on resume the producing task is not around to reference.
 */
export type TCNSPlannedTaskJSON = {
    /** Registry name of the neuron to (re)activate. */
    neuronName: string;
    /** Registry name of the dendrite collateral this task fires on. */
    dendriteCollateralName: string;
    /** The input signal that drives the task, if any (a {@link TCNSSignalJSON}). */
    input?: TCNSSignalJSON;
    /**
     * The activation's context store — the portable part of it. Whatever could
     * not survive the trip (a function, a symbol, a cycle, a live handle) was
     * left behind when this was written, the way a browser form drops what it
     * cannot carry.
     */
    activationContext?: TCNSContextStore;
};
