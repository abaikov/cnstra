import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from './TCNSAxon';
import { TCNSLocalContextValueStore } from './TCNSLocalContextValueStore';
import { TNCNeuronResponseReturn } from './TCNSNeuronResponseReturn';
import { ICNS } from '../interfaces/ICNS';

export type TCNSDendrite<
    TContextValue,
    TSenderCollateral extends CNSCollateral<unknown>,
    // We need axon type to be able to redirect to different collaterals
    TAxonType extends TCNSAxon
> = {
    collateral: TSenderCollateral;
    response: (
        payload: TSenderCollateral extends CNSCollateral<infer P> ? P : never,
        axon: TAxonType,
        ctx: TCNSLocalContextValueStore<TContextValue> & {
            abortSignal?: AbortSignal;
            cns?: ICNS<any, any>;
            stimulation?: any;
        }
    ) => TNCNeuronResponseReturn<TAxonType>;
};
