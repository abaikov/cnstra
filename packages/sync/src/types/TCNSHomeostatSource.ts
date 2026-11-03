export type TCNSHomeostatSource<TKey, TData> = {
    key: TKey;
    transduce: (abortSignal: AbortSignal) => Promise<TData>;
};
