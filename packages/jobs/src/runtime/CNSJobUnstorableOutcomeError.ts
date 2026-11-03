import type { TCNSJobAttemptOutcome } from '../types/TCNSJobAttemptOutcome';

export class CNSJobUnstorableOutcomeError extends Error {
    constructor(
        readonly outcome: TCNSJobAttemptOutcome,
        readonly cause: unknown
    ) {
        super(`job "${outcome.jobId}" attempt ${outcome.attemptNumber} has a result or attempt meta the repository cannot store`);
        this.name = 'UnstorableOutcomeError';
    }
}
