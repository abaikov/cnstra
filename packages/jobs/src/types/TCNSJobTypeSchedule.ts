import type { TCNSJobSchedule } from './TCNSJobSchedule';

export type TCNSJobTypeSchedule = TCNSJobSchedule & {
    jobType: string;
    fromDefinition: boolean;
};
