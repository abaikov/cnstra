import { ICNSCollateral } from '../interfaces/ICNSCollateral';

export type TCNSSignal<TCollateralName extends string, TPayload> = {
    collateralName: TCollateralName;
    payload?: TPayload;
};
