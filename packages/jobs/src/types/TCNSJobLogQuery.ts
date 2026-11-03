import type { TCNSJobLogCursor } from './TCNSJobLogCursor';

export type TCNSJobLogQuery = {
    attemptNumber?: number;
    after?: TCNSJobLogCursor;
    limit?: number;
};
