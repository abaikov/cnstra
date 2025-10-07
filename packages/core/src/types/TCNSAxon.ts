import { CNSCollateral } from '../CNSCollateral';

export type TCNSAxon<
    TCollateralName extends string,
    TInputPayload = unknown
> = {
    [K in TCollateralName]: CNSCollateral<K, TInputPayload>;
};
