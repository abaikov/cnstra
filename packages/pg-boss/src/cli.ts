#!/usr/bin/env node
/**
 * `cnstra-pgboss-progress migrate` — create the pg-boss progress table.
 *
 *   DATABASE_URL=postgres://... cnstra-pgboss-progress migrate
 *   CNS_PGBOSS_PROGRESS_TABLE=my_table  (optional; default cns_pgboss_progress)
 */
import { Pool } from 'pg';
import { ensureSchema, DEFAULT_TABLE } from './migrate';

async function main(): Promise<void> {
    const cmd = process.argv[2];
    if (cmd !== 'migrate') {
        console.error('usage: cnstra-pgboss-progress migrate'); // eslint-disable-line no-console
        process.exit(1);
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is required'); // eslint-disable-line no-console
        process.exit(1);
    }
    const table = process.env.CNS_PGBOSS_PROGRESS_TABLE ?? DEFAULT_TABLE;
    const pool = new Pool({ connectionString: url });
    try {
        await ensureSchema(pool, table);
        // eslint-disable-next-line no-console
        console.log(`✓ ensured progress table "${table}"`);
    } finally {
        await pool.end();
    }
}

void main().catch(e => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
});
