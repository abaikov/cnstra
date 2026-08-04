/**
 * The payload placed on a queue. It carries the collateral **name** and a
 * JSON-serializable payload — never live neuron/collateral object references,
 * which are not portable across processes. Shared by every broker integration.
 */
export interface TCNSStimulationJobData {
    collateralName: string;
    payload: unknown;
    /** Optional per-run cap on neuron hops. */
    maxNeuronHops?: number;
}

/** Structural view of the response passed to `onResponse` (not exported by core). */
export interface ICNSResponseLike {
    inputSignal?: { collateral?: unknown; payload?: unknown };
    outputSignal?: { collateral?: unknown; payload?: unknown };
    error?: unknown;
}
