import { ICNSCollateral } from '../interfaces/ICNSCollateral';

export type TCNSSignal<TCollateral extends ICNSCollateral<unknown>> = {
    collateral: TCollateral;
    payload?: TCollateral extends ICNSCollateral<infer P> ? P : never;
};
