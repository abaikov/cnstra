import type { ICNSJobLogRepository, TCNSJobLogEntry, TCNSJobLogQuery } from '@cnstra/jobs';
import type { ICNSPostgresJobConnection } from '../interfaces/ICNSPostgresJobConnection';
import { CNSPostgresJobSchema } from '../schema/CNSPostgresJobSchema';
import { CNSPostgresJobRows } from './CNSPostgresJobRows';

export class CNSPostgresJobLogRepository implements ICNSJobLogRepository {
    private readonly table: string;

    constructor(
        private readonly database: ICNSPostgresJobConnection,
        tablePrefix: string = CNSPostgresJobSchema.DEFAULT_TABLE_PREFIX
    ) {
        this.table = `${CNSPostgresJobSchema.assertTablePrefix(tablePrefix)}job_log`;
    }

    async append(jobId: string, entries: readonly TCNSJobLogEntry[]): Promise<void> {
        if (entries.length === 0) return;
        await this.database.query(
            `INSERT INTO ${this.table} (job_id, attempt_number, seq, at, kind, entry)
             SELECT $1, e.attempt_number, e.seq, e.at, e.kind, e.entry
             FROM unnest($2::int[], $3::int[], $4::float8[], $5::text[], $6::text[]::jsonb[]) AS e(attempt_number, seq, at, kind, entry)
             ON CONFLICT DO NOTHING`,
            [
                jobId,
                entries.map(entry => entry.attemptNumber),
                entries.map(entry => entry.seq),
                entries.map(entry => entry.at),
                entries.map(entry => entry.kind),
                entries.map(entry => CNSPostgresJobRows.json(entry.entry)),
            ]
        );
    }

    async list(jobId: string, query: TCNSJobLogQuery = {}): Promise<TCNSJobLogEntry[]> {
        const result = await this.database.query<{ attempt_number: number; seq: number; at: number; kind: string; entry: [unknown] | null }>(
            `SELECT attempt_number, seq, at, kind, CASE WHEN entry IS NULL THEN NULL ELSE jsonb_build_array(entry) END AS entry
             FROM ${this.table}
             WHERE job_id = $1
               AND ($2::int IS NULL OR attempt_number = $2)
               AND ($3::int IS NULL OR (attempt_number, seq) > ($3, $4::int))
             ORDER BY attempt_number, seq, at
             LIMIT $5`,
            [jobId, query.attemptNumber ?? null, query.after?.attemptNumber ?? null, query.after?.seq ?? null, query.limit ?? null]
        );
        return result.rows.map(row => {
            const entry: TCNSJobLogEntry = { attemptNumber: row.attempt_number, seq: row.seq, at: row.at, kind: row.kind };
            if (row.entry !== null) entry.entry = row.entry[0];
            return entry;
        });
    }

    async delete(jobIds: readonly string[]): Promise<void> {
        if (jobIds.length === 0) return;
        await this.database.query(`DELETE FROM ${this.table} WHERE job_id = ANY($1::text[])`, [jobIds]);
    }
}
