export type TCNSHomeostatTransductionCover = {
    readonly coveringName: string;
    readonly coveredName: string;
    readonly selectCoveredKey: (coveringKey: readonly unknown[]) => readonly unknown[];
    readonly revision?: string | undefined;
};
