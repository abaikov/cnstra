import type { ECNSJobCancelAs } from './ECNSJobCancelAs';

export type TCNSJobCancelRequest = {
    at: number;
    as: ECNSJobCancelAs;
};
