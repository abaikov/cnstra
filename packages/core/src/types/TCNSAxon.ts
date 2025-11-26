import { CNSCollateral } from '../CNSCollateral';

/**
 * Axon type used by neurons.
 *
 * Historically this type only took a collateral name union and a single payload
 * type, which meant every collateral on the axon was typed with the same
 * payload (typically a union of all possible payloads).
 *
 * That broke property-level typing on `axon.*.createSignal(...)` – the payload
 * parameter became a big union instead of the specific payload for that
 * collateral.
 *
 * To fix this while keeping existing generic call sites mostly intact, we add
 * a third type parameter that carries the original heterogeneous axon object.
 * When that third parameter is provided, we preserve the precise payload type
 * for each collateral.
 *
 * - `TCollateralName` / `TInputPayload` are still useful for higher-level
 *   generic constraints (unions of names / payloads).
 * - `TCollaterals` is the concrete axon map used to recover the per-key
 *   payload types.
 */
export type TCNSAxon<
    TCollateralName extends string,
    TInputPayload = unknown,
    TCollaterals extends Record<string, CNSCollateral<any, any>> = Record<
        TCollateralName,
        CNSCollateral<TCollateralName, TInputPayload>
    >
> = {
    [K in keyof TCollaterals]: TCollaterals[K];
};
