import type { ECNSJobFinalStatus } from './ECNSJobFinalStatus';

export type TCNSJobTransition = {
    jobId: string;
    seq: number;
    jobType: string;
    attemptNumber?: number;
    finalStatus?: ECNSJobFinalStatus;
};
