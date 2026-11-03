import type { ECNSJobThrottleScope } from './ECNSJobThrottleScope';
import type { TCNSJobAttempt } from './TCNSJobAttempt';
import type { TCNSJobState } from './TCNSJobState';

export type TCNSJobRunContext<TPayload = unknown> = {
    jobState: TCNSJobState<TPayload>;
    attempt: TCNSJobAttempt;
    abortSignal: AbortSignal;
    attemptMeta: { set(key: string, value: unknown): void };
    saveState(state: unknown): Promise<boolean>;
    log(kind: string, entry?: unknown): void;
    snooze(delayMs: number): void;
    throttle(delayMs: number, scope: ECNSJobThrottleScope): void;
    fail(errorName: string): void;
};
