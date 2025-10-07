import { ICNSCollateral } from '../interfaces/ICNSCollateral';

export type TCNSSignal<TCollateralName extends string, TPayload> = {
    collateral: ICNSCollateral<TCollateralName, TPayload>;
    payload?: TPayload;
};
