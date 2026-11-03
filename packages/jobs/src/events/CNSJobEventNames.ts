import type { ECNSJobEventName } from '../types/ECNSJobEventName';
import type { ECNSJobFinalStatus } from '../types/ECNSJobFinalStatus';

export class CNSJobEventNames {
    private static readonly FINISHED: Record<ECNSJobFinalStatus, ECNSJobEventName> = {
        completed: 'job.completed',
        failed: 'job.failed',
        cancelled: 'job.cancelled',
        superseded: 'job.superseded',
        expired: 'job.expired',
    };

    static finished(finalStatus: ECNSJobFinalStatus): ECNSJobEventName {
        return CNSJobEventNames.FINISHED[finalStatus];
    }
}
