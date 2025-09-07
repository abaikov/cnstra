import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from './TCNSAxon';
import { TCNSLocalContextValueStore } from './TCNSLocalContextValueStore';
import { TNCNeuronResponseReturn } from './TCNSNeuronResponseReturn';

export type TCNSDendrite<
    TContextValue,
    TSenderCollateralType extends string,
    TSenderAxonCollateralPayload,
    TReceiverCollateralType extends string,
    TReceiverAxonCollateralPayload,
    // We need axon type to be able to redirect to different collaterals
    TAxonType extends TCNSAxon<
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload
    >
> = {
    collateral: CNSCollateral<
        TSenderCollateralType,
        TSenderAxonCollateralPayload
    >;
    response: (
        payload: TSenderAxonCollateralPayload,
        axon: TAxonType,
        ctx: TCNSLocalContextValueStore<TContextValue> & {
            abortSignal?: AbortSignal;
            cns?: any;
        }
    ) => TNCNeuronResponseReturn<
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload
    >;
};
