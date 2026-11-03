import type { TCNSJob } from '@cnstra/jobs';

export type TCNSJobsEnqueueOptions<TTransaction> = Pick<TCNSJob, 'jobId' | 'jobKey' | 'jobGroup' | 'priority' | 'runAfter' | 'retry' | 'meta'> & {
    transaction?: TTransaction;
};
