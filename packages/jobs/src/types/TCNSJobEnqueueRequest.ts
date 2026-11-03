import type { ECNSJobKeyMode } from './ECNSJobKeyMode';
import type { TCNSJob } from './TCNSJob';
import type { TCNSJobDebounce } from './TCNSJobDebounce';

export type TCNSJobEnqueueRequest = {
    job: TCNSJob;
    keyMode?: ECNSJobKeyMode;
    uniqueWindowMs?: number;
    idempotencyWindowMs?: number;
    debounce?: TCNSJobDebounce;
};
