#!/usr/bin/env node
/**
 * `cnstra-persist-postgres migrate` — create the stimulation/attempt/task tables.
 *
 *   DATABASE_URL=postgres://... cnstra-persist-postgres migrate
 *   CNS_TABLE_PREFIX=my_ (optional; default cns_)
 */
import { Pool } from 'pg';
import { ensureSchema, DEFAULT_PREFIX } from './migrate';

async function main(): Promise<void> {
    const cmd = process.argv[2];
    if (cmd !== 'migrate') {
        console.error('usage: cnstra-persist-postgres migrate'); // eslint-disable-line no-console
        process.exit(1);
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is required'); // eslint-disable-line no-console
        process.exit(1);
    }
    const prefix = process.env.CNS_TABLE_PREFIX ?? DEFAULT_PREFIX;
    const pool = new Pool({ connectionString: url });
    try {
        await ensureSchema(pool, prefix);
        // eslint-disable-next-line no-console
        console.log(`✓ ensured stimulation/attempt/task tables (prefix "${prefix}")`);
    } finally {
        await pool.end();
    }
}

void main().catch(e => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
});
