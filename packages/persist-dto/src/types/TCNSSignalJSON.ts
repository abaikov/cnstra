/**
 * A signal referenced by **stable registry name** (not a live collateral object):
 * the collateral it rides on plus its payload. Portable across a process boundary,
 * JSON-safe. The shared signal leaf across the model — a stimulation's entry, an
 * attempt's activation input(s), a task's produced output.
 */
export type TCNSSignalJSON = {
    collateralName: string;
    payload: unknown;
};
