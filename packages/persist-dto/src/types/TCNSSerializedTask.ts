/**
 * One frontier activation task, serialized by **stable registry names** — no live
 * object references — so it survives a process boundary (queue retry, crash,
 * redeploy). Round-trips through JSON. Self-contained: its `input` is inline, since
 * on resume the producing task is not around to reference.
 */
export type TCNSSerializedTask = {
    /** Registry name of the neuron to (re)activate. */
    neuronName: string;
    /** Registry name of the dendrite collateral this task fires on. */
    dendriteCollateralName: string;
    /** The input signal that drives the task, if any. */
    input?: {
        collateralName: string;
        payload?: unknown;
    };
};
