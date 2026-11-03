import type { TCNSJob } from '../types/TCNSJob';
import type { TCNSJobEnqueueRequest } from '../types/TCNSJobEnqueueRequest';
import type { TCNSJobTypeDefinition } from '../types/TCNSJobTypeDefinition';

export class CNSJobEnqueueRequestBuilder {
    static build(job: TCNSJob, definition: TCNSJobTypeDefinition | undefined): TCNSJobEnqueueRequest {
        if (!definition) return { job };
        return {
            job: {
                ...job,
                jobKey: job.jobKey ?? definition.jobKey?.(job.payload),
                jobGroup: job.jobGroup ?? definition.jobGroup?.(job.payload),
                priority: job.priority ?? definition.priority,
                retry: job.retry ?? definition.retry,
            },
            keyMode: definition.keyMode,
            uniqueWindowMs: definition.uniqueWindowMs,
            idempotencyWindowMs: definition.idempotencyWindowMs,
            debounce: definition.debounce,
        };
    }
}
