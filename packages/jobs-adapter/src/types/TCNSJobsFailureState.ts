import type { TCNSJobsFailurePlace } from './TCNSJobsFailurePlace';

export type TCNSJobsFailureState<TPayload> = TCNSJobsFailurePlace & {
    jobId: string;
    payload: TPayload;
};
