import { ICNSCollateral } from '../interfaces/ICNSCollateral';

export type TCNSSignal<TCollateralType extends string, TPayload> = {
    collateral: ICNSCollateral<TCollateralType, TPayload>;
    payload?: TPayload;
};
