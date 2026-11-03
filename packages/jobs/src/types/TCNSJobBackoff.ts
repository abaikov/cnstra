import type { ECNSJobBackoffType } from './ECNSJobBackoffType';

export type TCNSJobBackoff = {
    type: ECNSJobBackoffType;
    delayMs: number;
    maxDelayMs?: number;
    jitter?: number;
};
