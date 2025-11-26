import { TCNSSignal } from './TCNSSignal';

/**
 * Allowed return types from a neuron dendrite `response` function.
 *
 * We deliberately allow signals whose `collateralName` is typed as `string`
 * (the common case when signals are constructed via helpers and re-exported),
 * while higher-level generics can still track a narrower union of collateral
 * names.
 */
export type TNCNeuronResponseReturn<TCollateralName extends string, TPayload> =
    | Promise<TCNSSignal<TCollateralName | string, TPayload>>
    | TCNSSignal<TCollateralName | string, TPayload>
    | Promise<TCNSSignal<TCollateralName | string, TPayload>[]>
    | TCNSSignal<TCollateralName | string, TPayload>[]
    | Promise<void>
    | void;
