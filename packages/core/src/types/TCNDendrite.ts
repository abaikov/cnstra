import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from './TCNSAxon';

export type TCNDendrite<
    TSenderCollateralIdType extends string,
    TSenderAxonCollateralPayload,
    TReceiverCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    TReceiverAxon extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
> = {
    collateral: CNSCollateral<
        TSenderCollateralIdType,
        TSenderAxonCollateralPayload
    >;
    reaction: (
        payload: TSenderAxonCollateralPayload,
        axon: TReceiverAxon
    ) =>
        | Promise<
              ReturnType<
                  CNSCollateral<
                      TReceiverCollateralIdType,
                      TReceiverAxonCollateralPayload
                  >['createSignal']
              >
          >
        | ReturnType<
              CNSCollateral<
                  TReceiverCollateralIdType,
                  TReceiverAxonCollateralPayload
              >['createSignal']
          >
        | Promise<void>
        | void;
};
