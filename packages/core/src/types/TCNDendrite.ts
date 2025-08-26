import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from './TCNSAxon';

export type TCNDendrite<
    TSenderCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    TReceiverCollateralIdType extends string,
    TReceiverAxon extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
> = {
    collateral: CNSCollateral<
        TSenderCollateralIdType,
        TReceiverAxonCollateralPayload
    >;
    reaction: (
        payload: TReceiverAxonCollateralPayload,
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
