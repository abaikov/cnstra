export type TCNSPagedRows<TRow> = {
    rows: TRow[];
    hasMore: boolean;
    isLoading: boolean;
    total: number | undefined;
};
