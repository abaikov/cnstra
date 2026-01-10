import { CNSCollateral } from '../CNSCollateral';

export type TCNSSignal<TCollateral extends CNSCollateral<unknown>> = {
    collateral: TCollateral;
    payload?: TCollateral extends CNSCollateral<infer P> ? P : never;
};
