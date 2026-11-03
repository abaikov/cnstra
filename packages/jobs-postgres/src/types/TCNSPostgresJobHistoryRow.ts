import type { ECNSJobFinalStatus, TCNSJobAttempt } from '@cnstra/jobs';

export type TCNSPostgresJobHistoryRow = {
    job_id: string;
    job_type: string;
    payload: [unknown] | null;
    meta: Record<string, unknown> | null;
    retry: Record<string, unknown> | null;
    job_key: string | null;
    job_group: string | null;
    priority: number;
    created_at: number;
    attempts: TCNSJobAttempt[];
    state: [unknown] | null;
    finished_at: number;
    final_status: ECNSJobFinalStatus;
};
