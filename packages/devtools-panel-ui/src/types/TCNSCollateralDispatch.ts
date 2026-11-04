export type TCNSCollateralDispatch = {
    stimulationId: string;
    stage: number;
    neuronName: string;
    isEntry: boolean;
    payload: unknown;
    error: string | null;
    startedAt: number;
};
