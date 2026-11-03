#!/usr/bin/env node
/**
 * `cnstra-pgboss-progress migrate` — create the pg-boss progress table.
 *
 *   DATABASE_URL=postgres://... cnstra-pgboss-progress migrate
 *   CNS_TABLE_PREFIX=my_  (optional; default cns_)
 */
import { Pool } from 'pg';
import { CNSPgBossProgressSchema } from './schema/CNSPgBossProgressSchema';

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
    const tablePrefix = process.env.CNS_TABLE_PREFIX ?? CNSPgBossProgressSchema.DEFAULT_TABLE_PREFIX;
    const pool = new Pool({ connectionString: url });
    try {
        await CNSPgBossProgressSchema.migrate(pool, tablePrefix);
        // eslint-disable-next-line no-console
        console.log(`✓ progress table is up to date "${CNSPgBossProgressSchema.table(tablePrefix)}"`);
    } finally {
        await pool.end();
    }
}

void main().catch(e => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
});
