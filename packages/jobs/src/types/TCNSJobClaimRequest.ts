import type { TCNSJobRate } from './TCNSJobRate';

export type TCNSJobClaimRequest = {
    jobType: string;
    free: number;
    leaseMs: number;
    maxRunning?: number;
    maxRunningPerGroup?: number;
    rate?: TCNSJobRate;
    groupRate?: TCNSJobRate;
    fairness?: boolean;
    maxStarted?: number;
};
