export type TCNSHomeostatModelSummaryCollectionOptions<TReceptiveDemand> = {
    readonly isSameValue: (previous: unknown, next: unknown) => boolean;
    readonly receptiveDemand: TReceptiveDemand | undefined;
    readonly keepAfterIdleMs: number;
};
