import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from './TCNSAxon';
import { TCNSLocalContextValueStore } from './TCNSLocalContextValueStore';
import { TNCNeuronResponseReturn } from './TCNSNeuronResponseReturn';

export type TCNSDendrite<
    TContextValue,
    TSenderCollateralIdType extends string,
    TSenderAxonCollateralPayload,
    TReceiverCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    // We need axon type to be able to redirect to different collaterals
    TAxonType extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
> = {
    collateral: CNSCollateral<
        TSenderCollateralIdType,
        TSenderAxonCollateralPayload
    >;
    response: (
        payload: TSenderAxonCollateralPayload,
        axon: TAxonType,
        ctx: TCNSLocalContextValueStore<TContextValue>,
        abortSignal?: AbortSignal
    ) => TNCNeuronResponseReturn<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >;
};
