import { CNSCollateral } from '../CNSCollateral';

export type TNCNeuronResponseReturn<TCollateralType extends string, TPayload> =
    | Promise<
          ReturnType<CNSCollateral<TCollateralType, TPayload>['createSignal']>
      >
    | ReturnType<CNSCollateral<TCollateralType, TPayload>['createSignal']>
    | Promise<void>
    | void;
