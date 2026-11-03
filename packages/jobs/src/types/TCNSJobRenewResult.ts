import type { TCNSJobCancelRequest } from './TCNSJobCancelRequest';
import type { TCNSJobLease } from './TCNSJobLease';

export type TCNSJobRenewResult = {
    lostLeases: TCNSJobLease[];
    cancelRequests: Array<{ lease: TCNSJobLease; cancelRequest: TCNSJobCancelRequest }>;
};
