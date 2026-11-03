import type { TCNSJobAttemptOutcome } from './TCNSJobAttemptOutcome';

export type TCNSJobPendingOutcome = {
    outcome: TCNSJobAttemptOutcome;
    jobGroup?: string;
    startedAt: number;
    settledAt: number;
    error?: unknown;
    started: boolean;
};
