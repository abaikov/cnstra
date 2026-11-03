import type { TCNSJob } from '../types/TCNSJob';
import type { TCNSJobEnqueueResult } from '../types/TCNSJobEnqueueResult';
import type { CNSJobEventEmitter } from './CNSJobEventEmitter';
import { CNSJobTransitionEvents } from './CNSJobTransitionEvents';

export class CNSJobEnqueueEvents {
    static emitLeft(events: CNSJobEventEmitter, job: TCNSJob, result: TCNSJobEnqueueResult): void {
        const { jobType, jobGroup } = job;
        for (const jobId of result.supersededJobIds) events.emit({ name: 'job.superseded', jobId, jobType, jobGroup });
        CNSJobTransitionEvents.emitFinished(events, result.transitions ?? []);
    }
}
