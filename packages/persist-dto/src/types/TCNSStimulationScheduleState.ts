export type TCNSStimulationScheduleState = {
    scheduleId: string;
    collateralName: string;
    cron?: string;
    everyMs?: number;
    tz?: string;
};
