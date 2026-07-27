/**
 * A signal referenced by **stable registry name** (not a live collateral object):
 * the collateral it rides on plus its payload. Portable across a process boundary,
 * JSON-safe. Shared by both the emit (`...Dto`) and stored (`...Persisted`) forms —
 * a run's entry, a stimulation's activation input(s), a task's produced output.
 */
export type TCNSSignalRef = {
    collateralName: string;
    payload: unknown;
};
