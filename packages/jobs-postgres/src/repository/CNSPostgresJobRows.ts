import { CNSJobJsonValue } from '@cnstra/jobs';
import type { TCNSJobHistoryState, TCNSJobState } from '@cnstra/jobs';
import type { TCNSPostgresJobHistoryRow } from '../types/TCNSPostgresJobHistoryRow';
import type { TCNSPostgresJobRow } from '../types/TCNSPostgresJobRow';

export class CNSPostgresJobRows {
    static readonly JOB_COLUMNS = `job_id, seq::float8 AS seq, job_type,
        CASE WHEN payload IS NULL THEN NULL ELSE jsonb_build_array(payload) END AS payload,
        meta, retry, job_key, job_group, priority, run_after, created_at, attempts, locked_until, wait,
        CASE WHEN state IS NULL THEN NULL ELSE jsonb_build_array(state) END AS state`;

    static readonly HISTORY_COLUMNS = `job_id, job_type,
        CASE WHEN payload IS NULL THEN NULL ELSE jsonb_build_array(payload) END AS payload,
        meta, retry, job_key, job_group, priority, created_at, attempts,
        CASE WHEN state IS NULL THEN NULL ELSE jsonb_build_array(state) END AS state,
        finished_at, final_status`;

    static json(value: unknown): string | null {
        return CNSJobJsonValue.text(value) ?? null;
    }

    static copy<TValue>(value: TValue): TValue {
        return CNSJobJsonValue.copy(value);
    }

    static toState(row: TCNSPostgresJobRow): TCNSJobState {
        const jobState: TCNSJobState = {
            jobId: row.job_id,
            seq: row.seq,
            jobType: row.job_type,
            payload: row.payload?.[0],
            priority: row.priority,
            runAfter: row.run_after,
            createdAt: row.created_at,
            attempts: row.attempts,
        };
        if (row.meta !== null) jobState.meta = row.meta;
        if (row.retry !== null) jobState.retry = row.retry;
        if (row.job_key !== null) jobState.jobKey = row.job_key;
        if (row.job_group !== null) jobState.jobGroup = row.job_group;
        if (row.locked_until !== null) jobState.lockedUntil = row.locked_until;
        if (row.wait !== null) jobState.wait = row.wait;
        if (row.state !== null) jobState.state = row.state[0];
        return jobState;
    }

    static toHistory(row: TCNSPostgresJobHistoryRow): TCNSJobHistoryState {
        const finished: TCNSJobHistoryState = {
            jobId: row.job_id,
            jobType: row.job_type,
            payload: row.payload?.[0],
            priority: row.priority,
            createdAt: row.created_at,
            attempts: row.attempts,
            finishedAt: row.finished_at,
            finalStatus: row.final_status,
        };
        if (row.meta !== null) finished.meta = row.meta;
        if (row.retry !== null) finished.retry = row.retry;
        if (row.job_key !== null) finished.jobKey = row.job_key;
        if (row.job_group !== null) finished.jobGroup = row.job_group;
        if (row.state !== null) finished.state = row.state[0];
        return finished;
    }
}
