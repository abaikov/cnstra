import type { TCNSJob } from './TCNSJob';

export type TCNSJobSchedule = {
    scheduleId: string;
    cron?: string;
    everyMs?: number;
    tz?: string;
    startAt?: number;
    endAt?: number;
    maxRuns?: number;
    template?: Omit<TCNSJob, 'jobType' | 'jobId' | 'runAfter' | 'createdAt'>;
};
