import type { ECNSJobWait, TCNSJobAttempt } from '@cnstra/jobs';

export type TCNSPostgresJobRow = {
    job_id: string;
    seq: number;
    job_type: string;
    payload: [unknown] | null;
    meta: Record<string, unknown> | null;
    retry: Record<string, unknown> | null;
    job_key: string | null;
    job_group: string | null;
    priority: number;
    run_after: number;
    created_at: number;
    attempts: TCNSJobAttempt[];
    locked_until: number | null;
    wait: ECNSJobWait | null;
    state: [unknown] | null;
};
