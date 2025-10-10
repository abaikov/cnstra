export type TCNSSerializedSignal<
    TCollateralName extends string = string,
    TPayload = any
> = {
    collateralName: TCollateralName;
    payload: TPayload | undefined;
};

export type TCNSSerializedQueueItem<
    TCollateralName extends string = string,
    TNeuronName extends string = string
> = {
    neuronId: TNeuronName;
    dendriteCollateralName: TCollateralName;
    input?: TCNSSerializedSignal<TCollateralName, any>;
};
