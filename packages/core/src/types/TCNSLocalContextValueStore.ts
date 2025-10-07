export type TCNSLocalContextValueStore<TContextValue> = {
    get: () => TContextValue | undefined;
    set: (value: TContextValue) => void;
    delete: () => void;
};
