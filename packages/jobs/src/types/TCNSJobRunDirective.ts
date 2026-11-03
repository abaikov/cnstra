import type { ECNSJobThrottleScope } from './ECNSJobThrottleScope';

export type TCNSJobRunDirective =
    | { kind: 'snooze'; delayMs: number }
    | { kind: 'throttle'; delayMs: number; scope: ECNSJobThrottleScope }
    | { kind: 'fail'; errorName: string };
