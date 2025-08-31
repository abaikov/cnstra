import { CNSCollateral } from '../CNSCollateral';

export type TNCNeuronResponseReturn<TCollateralId extends string, TPayload> =
    | Promise<
          ReturnType<CNSCollateral<TCollateralId, TPayload>['createSignal']>
      >
    | ReturnType<CNSCollateral<TCollateralId, TPayload>['createSignal']>
    | Promise<void>
    | void;
