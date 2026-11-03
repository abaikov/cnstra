import type { TCNSJobListCursor } from './TCNSJobListCursor';

export type TCNSJobListQuery = {
    jobTypes?: readonly string[];
    running?: boolean;
    after?: TCNSJobListCursor;
    limit?: number;
};
