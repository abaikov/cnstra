export type TCNSSignal<TType extends string, TPayload> = {
    type: TType;
    payload?: TPayload;
};
