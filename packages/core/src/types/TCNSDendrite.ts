import { CNSCollateral } from '../CNSCollateral';
import { ICNS } from '../interfaces/ICNS';
import { TCNSAxon } from './TCNSAxon';
import { TCNSLocalContextValueStore } from './TCNSLocalContextValueStore';
import { TNCNeuronResponseReturn } from './TCNSNeuronResponseReturn';

export type TCNSDendrite<
    TContextValue,
    TSenderCollateralName extends string,
    TSenderAxonCollateralPayload,
    TReceiverCollateralName extends string,
    TReceiverAxonCollateralPayload,
    // We need axon type to be able to redirect to different collaterals
    TAxonType extends TCNSAxon<
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload
    >
> = {
    collateral: CNSCollateral<
        TSenderCollateralName,
        TSenderAxonCollateralPayload
    >;
    response: (
        payload: TSenderAxonCollateralPayload,
        axon: TAxonType,
        ctx: TCNSLocalContextValueStore<TContextValue> & {
            abortSignal?: AbortSignal;
            cns?: ICNS<any, any>;
            stimulationId?: string;
        }
    ) => TNCNeuronResponseReturn<
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload
    >;
};
