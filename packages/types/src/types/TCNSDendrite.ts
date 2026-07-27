import { ICNSCollateral } from '../interfaces/ICNSCollateral';
import { TCNSAxon } from './TCNSAxon';
import { TNCNeuronResponseReturn } from './TCNSNeuronResponseReturn';
import { TCNSHandlerContext } from './TCNSHandlerContext';

export type TCNSDendrite<
    TContextValue,
    TSenderCollateral extends ICNSCollateral<unknown>,
    // We need axon type to be able to redirect to different collaterals
    TAxonType extends TCNSAxon,
    // Extra ctx fields poured in by factory layers (e.g. withGlobal). Defaults to
    // `unknown` → the base ctx bag, so plain dendrites carry no extra surface.
    TExt = unknown
> = {
    collateral: TSenderCollateral;
    response: (
        payload: TSenderCollateral extends ICNSCollateral<infer P> ? P : never,
        axon: TAxonType,
        ctx: TCNSHandlerContext<TContextValue, TExt>
    ) => TNCNeuronResponseReturn<TAxonType>;
};
