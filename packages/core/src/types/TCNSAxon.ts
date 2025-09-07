import { CNSCollateral } from '../CNSCollateral';

export type TCNSAxon<
    TCollateralType extends string,
    TInputPayload = unknown
> = {
    [K in TCollateralType]: CNSCollateral<K, TInputPayload>;
};
