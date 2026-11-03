import type { ECNSJobEnqueueStatus } from './ECNSJobEnqueueStatus';
import type { TCNSJobTransition } from './TCNSJobTransition';

export type TCNSJobEnqueueResult = {
    jobId: string;
    status: ECNSJobEnqueueStatus;
    supersededJobIds: string[];
    transitions?: TCNSJobTransition[];
};
