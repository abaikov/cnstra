export type TCNSSignal<TCollateralName extends string, TPayload> = {
    collateralName: TCollateralName;
    payload?: TPayload;
};
