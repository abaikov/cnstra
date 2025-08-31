import { ICNSCollateral } from '../interfaces/ICNSCollateral';

export type TCNSSignal<TCollateralId extends string, TPayload> = {
    collateral: ICNSCollateral<TCollateralId, TPayload>;
    payload?: TPayload;
};
