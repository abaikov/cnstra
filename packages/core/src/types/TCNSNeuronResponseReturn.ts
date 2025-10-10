import { CNSCollateral } from '../CNSCollateral';

export type TNCNeuronResponseReturn<TCollateralName extends string, TPayload> =
    | Promise<
          ReturnType<CNSCollateral<TCollateralName, TPayload>['createSignal']>
      >
    | ReturnType<CNSCollateral<TCollateralName, TPayload>['createSignal']>
    | Promise<
          ReturnType<CNSCollateral<TCollateralName, TPayload>['createSignal']>[]
      >
    | ReturnType<CNSCollateral<TCollateralName, TPayload>['createSignal']>[]
    | Promise<void>
    | void;
