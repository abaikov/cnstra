import type { ECNSJobAttemptStatus } from './ECNSJobAttemptStatus';
import type { ECNSJobFinalStatus } from './ECNSJobFinalStatus';
import type { TCNSJobThrottle } from './TCNSJobThrottle';

type TCNSJobAttemptOutcomeBase = {
    jobId: string;
    seq: number;
    attemptNumber: number;
    attemptMeta?: Record<string, unknown>;
    errorName?: string;
    throttle?: TCNSJobThrottle;
};

export type TCNSJobAttemptOutcome =
    | (TCNSJobAttemptOutcomeBase & {
          kind: 'completed';
          result?: unknown;
      })
    | (TCNSJobAttemptOutcomeBase & {
          kind: 'requeue';
          attemptStatus: Extract<ECNSJobAttemptStatus, 'failed' | 'stale' | 'aborted' | 'snoozed'>;
          runAfter: number;
      })
    | (TCNSJobAttemptOutcomeBase & {
          kind: 'final';
          attemptStatus: Extract<ECNSJobAttemptStatus, 'failed' | 'stale' | 'cancelled'>;
          finalStatus: Exclude<ECNSJobFinalStatus, 'completed'>;
      });
