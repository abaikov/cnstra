export type TCNSJobLease = {
    jobId: string;
    seq: number;
    attemptNumber: number;
    leaseMs: number;
};
