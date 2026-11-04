import { Pool } from 'pg';
import { CNSPostgresStimulationRepository } from '.././CNSPostgresStimulationRepository';
import { CNSPostgresStimulationSchema } from '.././schema/CNSPostgresStimulationSchema';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

// Live integration test for the roster-query pushdown — runs only when
// DATABASE_URL points at a reachable Postgres (else the whole block is skipped).
// It also seeds an in-memory store with the SAME data and asserts the Postgres
// SQL results equal the in-memory reference derivation — the contract both must
// meet. Without a DB this is describe.skip (green, nothing run).
const URL = process.env.DATABASE_URL;
const d = URL ? describe : describe.skip;
jest.setTimeout(30000);

const stim = (
    id: string,
    entryCollateral: string,
    status: 'running' | 'completed' | 'failed',
    payload: unknown
): TCNSStimulationState => ({
    stimulationId: id,
    entry: { collateralName: entryCollateral, payload },
    status,
    progress: { tasks: [] },
    scopeName: 'app:main',
});
const attempt = (
    id: string,
    startedAt: number,
    status: 'running' | 'completed' | 'failed'
): TCNSStimulationAttempt => ({
    stimulationAttemptId: `${id}#1`,
    stimulationId: id,
    attemptNumber: 1,
    status,
    startedAt,
    completedAt: status === 'running' ? null : startedAt + 100,
    hopCount: 2,
    hasError: status === 'failed',
    replayOf: null,
    entry: [{ collateralName: 'e', payload: {} }],
});
const task = (id: string, neuron: string): TCNSStimulationTask => ({
    stimulationAttemptId: `${id}#1`,
    index: 0,
    neuronName: neuron,
    dendriteCollateralName: 'in',
    inputIndex: 0,
    output: { collateralName: 'out', payload: {} },
    status: 'done',
    error: null,
    startedAt: 1000,
    duration: 5,
});

const SEED = [
    ['s1', 'import-doc', 'completed', 1000, 'parser', { pages: 3 }],
    ['s2', 'import-doc', 'failed', 2000, 'parser', { pages: 5 }],
    ['s3', 'send-email', 'completed', 3000, 'mailer', { pages: 0 }],
] as const;

async function seed(repo: {
    saveStimulation: (s: TCNSStimulationState) => Promise<void>;
    saveAttempt: (a: TCNSStimulationAttempt) => Promise<void>;
    appendTask: (t: TCNSStimulationTask) => Promise<void>;
}) {
    for (const [id, col, st, t, neuron, payload] of SEED) {
        await repo.saveStimulation(stim(id, col, st, payload));
        await repo.saveAttempt(attempt(id, t, st));
        await repo.appendTask(task(id, neuron));
    }
}

d('CNSPostgresStimulationRepository roster pushdown (live Postgres)', () => {
    const prefix = `cnstest_roster_${Date.now().toString(36)}_`;
    let pool: Pool;
    let repo: CNSPostgresStimulationRepository;
    let mem: CNSInMemoryStimulationRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: URL });
        repo = new CNSPostgresStimulationRepository({ pool, tablePrefix: prefix });
        mem = new CNSInMemoryStimulationRepository();
        await seed(repo);
        await seed(mem);
    });
    afterAll(async () => {
        await pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresStimulationSchema.tables(prefix), CNSPostgresStimulationSchema.migrationTable(prefix)].join(', ')} CASCADE`
        );
        await pool.end();
    });

    test('queryRoster: newest-first, filter, keyset — matches in-memory', async () => {
        const all = await repo.queryRoster({}, { limit: 50 });
        expect(all.total).toBe(3);
        expect(all.rows.map(r => r.stimulationId)).toEqual(['s3', 's2', 's1']);
        const s2 = all.rows.find(r => r.stimulationId === 's2')!;
        expect(s2.entry.collateralName).toBe('import-doc');
        expect(s2.hasError).toBe(true);
        expect(s2.startedAt).toBe(2000);
        expect(s2.hopCount).toBe(2);

        // filter parity
        const filtered = await repo.queryRoster(
            { status: 'completed', entryCollateralName: 'import-doc' },
            { limit: 50 }
        );
        expect(filtered.rows.map(r => r.stimulationId)).toEqual(['s1']);

        // keyset parity with the in-memory reference
        const p1 = await repo.queryRoster({}, { limit: 2 });
        const m1 = await mem.queryRoster({}, { limit: 2 });
        expect(p1.rows.map(r => r.stimulationId)).toEqual(['s3', 's2']);
        expect(p1.nextCursor).toBeTruthy();
        const p2 = await repo.queryRoster({}, { limit: 2, cursor: p1.nextCursor! });
        const m2 = await mem.queryRoster(
            {},
            { limit: 2, cursor: m1.nextCursor! }
        );
        expect(p2.rows.map(r => r.stimulationId)).toEqual(['s1']);
        expect(p2.rows.map(r => r.stimulationId)).toEqual(
            m2.rows.map(r => r.stimulationId)
        );
        expect(p2.nextCursor).toBeNull();
    });

    test('a page bounded by sinceCursor matches the in-memory reference', async () => {
        const m1 = await mem.queryRoster({}, { limit: 2 });
        const boundary = m1.nextCursor!;
        const head = await repo.queryRoster({}, { limit: 10, sinceCursor: boundary });
        const memHead = await mem.queryRoster({}, { limit: 10, sinceCursor: boundary });
        expect(head.rows.map(r => r.stimulationId)).toEqual(memHead.rows.map(r => r.stimulationId));
        expect(head.total).toBe(memHead.total);
    });

    test('total is the size of the FILTERED SET, not of the page remainder', async () => {
        // The contract says the pushdown store and the in-memory reference give
        // identical results. `total` drives "N runs" in the panel and its
        // progress bar — if it shrinks as you page, the count is meaningless.
        const p1 = await repo.queryRoster({}, { limit: 2 });
        const m1 = await mem.queryRoster({}, { limit: 2 });
        expect(p1.total).toBe(m1.total);

        const p2 = await repo.queryRoster({}, { limit: 2, cursor: p1.nextCursor! });
        const m2 = await mem.queryRoster({}, { limit: 2, cursor: m1.nextCursor! });

        expect(m2.total).toBe(3);
        expect(p2.total).toBe(m2.total);
    });

    test('pages correctly when a stimulation id contains the cursor separator', async () => {
        // The id is a key the caller chose. `order|42` is a plausible business
        // key, and splitting the cursor on every `|` would truncate it — the
        // page would then be taken from a run that does not exist.
        const weird = 'ord|er-9';
        await repo.saveStimulation({
            stimulationId: weird,
            entry: { collateralName: 'import-doc', payload: null },
            status: 'completed',
            progress: { tasks: [] },
        });
        await repo.saveAttempt({
            stimulationAttemptId: `${weird}#1`,
            stimulationId: weird,
            attemptNumber: 1,
            status: 'completed',
            startedAt: 4000,
            completedAt: 4100,
            hopCount: 1,
            hasError: false,
            replayOf: null,
            entry: [{ collateralName: 'import-doc', payload: null }],
        });

        const page1 = await repo.queryRoster({}, { limit: 1 });
        expect(page1.rows[0].stimulationId).toBe(weird);
        expect(page1.nextCursor).toBeTruthy();

        const page2 = await repo.queryRoster({}, {
            limit: 10,
            cursor: page1.nextCursor!,
        });
        // Everything older than the odd id, and never the odd id itself again.
        expect(page2.rows.map(r => r.stimulationId)).toEqual(['s3', 's2', 's1']);

        // The fixture is shared with the rest of the block — leave it as found.
        await repo.delete(weird);
    });

    test('a time window keeps a run whose FIRST attempt predates it out', async () => {
        // The window prunes on the attempts' own indexed column, but a run's
        // startedAt is the MIN over all of them — so pruning must not raise that
        // MIN and let an older run in through the back door.
        const older = 'older-run';
        await repo.saveStimulation({
            stimulationId: older,
            entry: { collateralName: 'import-doc', payload: null },
            status: 'failed',
            progress: { tasks: [] },
        });
        // First attempt well before the window, second one inside it.
        await repo.saveAttempt({
            stimulationAttemptId: `${older}#1`,
            stimulationId: older,
            attemptNumber: 1,
            status: 'failed',
            startedAt: 500,
            completedAt: 600,
            hopCount: 1,
            hasError: true,
            replayOf: null,
            entry: [{ collateralName: 'import-doc', payload: null }],
        });
        await repo.saveAttempt({
            stimulationAttemptId: `${older}#2`,
            stimulationId: older,
            attemptNumber: 2,
            status: 'completed',
            startedAt: 5000,
            completedAt: 5100,
            hopCount: 1,
            hasError: false,
            replayOf: null,
            entry: [{ collateralName: 'import-doc', payload: null }],
        });

        const windowed = await repo.queryRoster({ since: 4000 }, { limit: 50 });
        const mem = await repo.queryRoster({ since: 4000 }, { limit: 50 });

        // Its startedAt is 500, so it is outside the window even though attempt
        // #2 is inside it.
        expect(windowed.rows.map(r => r.stimulationId)).not.toContain(older);
        expect(mem.rows.map(r => r.stimulationId)).not.toContain(older);

        await repo.delete(older);
    });

    test('a time window returns the runs inside it', async () => {
        const all = await repo.queryRoster({}, { limit: 50 });
        expect(all.rows.length).toBeGreaterThan(0);

        // s1/s2/s3 start at 1000/2000/3000 in the fixture.
        const windowed = await repo.queryRoster(
            { since: 2000, until: 3000 },
            { limit: 50 }
        );
        expect(windowed.rows.map(r => r.stimulationId).sort()).toEqual([
            's2',
            's3',
        ]);
    });

    test('total survives a filter combined with a cursor', async () => {
        const p1 = await repo.queryRoster({ status: 'completed' }, { limit: 1 });
        const m1 = await mem.queryRoster({ status: 'completed' }, { limit: 1 });
        expect(p1.total).toBe(m1.total);

        if (p1.nextCursor) {
            const p2 = await repo.queryRoster(
                { status: 'completed' },
                { limit: 1, cursor: p1.nextCursor }
            );
            const m2 = await mem.queryRoster(
                { status: 'completed' },
                { limit: 1, cursor: m1.nextCursor! }
            );
            expect(p2.total).toBe(m2.total);
        }
    });

    test('queryRoster: neuronName filter uses the activated-neuron set', async () => {
        expect(
            (await repo.queryRoster({ neuronName: 'mailer' }, { limit: 50 })).rows
                .map(r => r.stimulationId)
        ).toEqual(['s3']);
        expect(
            (await repo.queryRoster({ neuronName: 'nope' }, { limit: 50 })).total
        ).toBe(0);
    });

    test('queryFacets: byEntryCollateral / byStatus / byNeuron / byTime(+metric) — matches in-memory', async () => {
        const pg = await repo.queryFacets({}, { metricPath: 'pages' });
        const ref = await mem.queryFacets({}, { metricPath: 'pages' });

        const norm = (arr: { name?: string; status?: string; count: number }[]) =>
            [...arr].sort((a, b) =>
                (a.name ?? a.status ?? '').localeCompare(b.name ?? b.status ?? '')
            );
        expect(norm(pg.byEntryCollateral)).toEqual(norm(ref.byEntryCollateral));
        expect(norm(pg.byStatus)).toEqual(norm(ref.byStatus));
        expect(norm(pg.byNeuron)).toEqual(norm(ref.byNeuron));

        // byTime metric sum = 3 + 5 + 0 pages
        const metricSum = pg.byTime.reduce((n, b) => n + (b.metric ?? 0), 0);
        expect(metricSum).toBe(8);
        const refSum = ref.byTime.reduce((n, b) => n + (b.metric ?? 0), 0);
        expect(metricSum).toBe(refSum);
    });

    /**
     * The facets are four small tallies. They used to be produced by shipping the
     * ENTIRE filtered set to Node and counting there, so the wire cost grew with
     * the number of runs while the answer stayed the same size.
     *
     * What must hold is a shape, not a duration: what comes back from the database
     * is bounded by the number of distinct keys, never by the number of runs.
     */
    describe('the facet tallies are counted in the database', () => {
        /** Rows the DB actually returned for one `queryFacets`, and the query count. */
        const measure = async (
            r: CNSPostgresStimulationRepository,
            metricPath?: string
        ): Promise<{ rows: number; queries: number }> => {
            const db = (
                r as unknown as {
                    db: { query: (...args: unknown[]) => Promise<{ rows: unknown[] }> };
                }
            ).db;
            const original = db.query.bind(db);
            let rows = 0;
            let queries = 0;
            db.query = async (...args: unknown[]) => {
                const res = await original(...args);
                queries += 1;
                rows += res.rows.length;
                return res;
            };
            try {
                await r.queryFacets({}, metricPath ? { metricPath } : undefined);
            } finally {
                db.query = original;
            }
            return { rows, queries };
        };

        it('answers in one query', async () => {
            expect((await measure(repo)).queries).toBe(1);
        });

        it('returns the tallies, not the runs behind them', async () => {
            const before = await measure(repo, 'pages');

            // Ten more runs of the SAME two entry collaterals and two neurons: the
            // set of keys does not grow, so neither may the result.
            for (let i = 0; i < 10; i++) {
                const id = `bulk-${i}`;
                const [, col, st, , neuron, payload] = SEED[i % SEED.length];
                await repo.saveStimulation(stim(id, col, st as never, payload));
                await repo.saveAttempt(attempt(id, 1500 + i, st as never));
                await repo.appendTask(task(id, neuron));
            }

            const after = await measure(repo, 'pages');
            try {
                expect(after.queries).toBe(1);
                // Buckets can differ (the span changed), but the answer must not
                // grow anywhere near by the ten runs added.
                expect(after.rows).toBeLessThan(before.rows + 5);
                // And it is genuinely small — a handful of keys, not 13 runs.
                expect(after.rows).toBeLessThan(13);
            } finally {
                for (let i = 0; i < 10; i++) await repo.delete(`bulk-${i}`);
            }
        });

        it('still counts every run it was given', async () => {
            const facets = await repo.queryFacets({});
            const total = facets.byStatus.reduce((n, s) => n + s.count, 0);
            expect(total).toBe(SEED.length);
        });

        /**
         * The window filters on `started_at` ALONE, over every run. A b-tree
         * leading with `stimulation_id` cannot serve that — a range seek needs
         * its leading column pinned — so the schema carries an index on
         * `started_at` by itself.
         *
         * Asked as a plan question rather than a timing one, and asked about
         * WHICH index: a started_at predicate against the composite is still
         * reported as an `Index Cond`, because Postgres pushes it into a full
         * scan of that index — so the presence of an `Index Cond` discriminates
         * nothing. The index the plan names does.
         */
        it('prunes the window with the index that leads on started_at', async () => {
            const client = await pool.connect();
            try {
                // Three seeded runs is far too few for the planner to prefer an
                // index on its own; the question here is whether one is USABLE.
                await client.query('BEGIN');
                await client.query('SET LOCAL enable_seqscan = off');
                const res = await client.query(
                    `EXPLAIN SELECT s.stimulation_id
                     FROM ${prefix}stimulation s
                     WHERE s.started_at >= $1
                     ORDER BY s.started_at DESC, s.stimulation_id COLLATE "C" DESC`,
                    [2000]
                );
                await client.query('ROLLBACK');

                const plan = (res.rows as { 'QUERY PLAN': string }[])
                    .map(r => r['QUERY PLAN'])
                    .join('\n');
                expect(plan).toContain(
                    `${prefix}stimulation_started_idx`
                );
            } finally {
                client.release();
            }
        });
    });
});

/**
 * The roster listing throws the per-run neuron array away; only the facet rails
 * and a neuron filter read it. Building it means aggregating the task table,
 * which under `'full'` volume holds one row per hop of all history — and the
 * panel polls the listing every two seconds.
 *
 * Dropping it cannot move the set: the aggregate is LEFT JOINed, and the only
 * predicate over `neurons` is guarded by `$4::text IS NULL`. That is what the
 * live cases above assert; these assert it is actually dropped.
 */
describe('the roster listing and the task table', () => {
    const capturing = () => {
        const sql: string[] = [];
        const repo = new CNSPostgresStimulationRepository({
            queryable: {
                query: async (text: string) => {
                    sql.push(text);
                    return { rows: [] };
                },
            },
            tablePrefix: 'cap_',
            autoMigrate: false,
        });
        return { repo, sql };
    };

    it('is not read for a plain listing', async () => {
        const { repo, sql } = capturing();
        await repo.queryRoster({}, { limit: 10 });

        expect(sql).toHaveLength(1);
        expect(sql[0]).not.toContain('cap_stimulation_task');
        expect(sql[0]).not.toContain('ARRAY_AGG(DISTINCT');
    });

    it('is read when the filter names a neuron', async () => {
        const { repo, sql } = capturing();
        await repo.queryRoster({ neuronName: 'parser' }, { limit: 10 });

        expect(sql[0]).toContain('cap_stimulation_task');
    });

    it('is read for the facet rails', async () => {
        const { repo, sql } = capturing();
        await repo.queryFacets({});

        expect(sql[0]).toContain('cap_stimulation_task');
    });
});


d('roster fields kept on the stimulation row (live Postgres)', () => {
    const prefix = `cnsroll_${Date.now().toString(36)}_`;
    let pool: Pool;
    let repo: CNSPostgresStimulationRepository;
    let mem: CNSInMemoryStimulationRepository;

    beforeAll(() => {
        pool = new Pool({ connectionString: URL, max: 8 });
        repo = new CNSPostgresStimulationRepository({ pool, tablePrefix: prefix });
        mem = new CNSInMemoryStimulationRepository();
    });
    afterAll(async () => {
        await pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresStimulationSchema.tables(prefix), CNSPostgresStimulationSchema.migrationTable(prefix)].join(', ')} CASCADE`
        );
        await pool.end();
    });

    it('lists a run before its first attempt arrives, as the in-memory reference does', async () => {
        for (const store of [repo, mem]) await store.saveStimulation(stim('no_attempt', 'import-doc', 'running', {}));

        const [fromPostgres, fromMemory] = await Promise.all([repo.queryRoster({}, { limit: 10 }), mem.queryRoster({}, { limit: 10 })]);

        expect(fromPostgres.rows).toEqual(fromMemory.rows);
        expect(fromPostgres.rows.find(r => r.stimulationId === 'no_attempt')?.startedAt).toBe(0);
    });

    it('keeps a run without an attempt out of the time histogram, as the in-memory reference does', async () => {
        for (const store of [repo, mem]) {
            await store.saveStimulation(stim('timed_a', 'import-doc', 'completed', {}));
            await store.saveAttempt(attempt('timed_a', 5_000_000, 'completed'));
            await store.saveStimulation(stim('timed_b', 'import-doc', 'completed', {}));
            await store.saveAttempt(attempt('timed_b', 5_004_000, 'completed'));
            await store.saveStimulation(stim('timed_none', 'import-doc', 'running', {}));
        }

        const [fromPostgres, fromMemory] = await Promise.all([repo.queryFacets({}), mem.queryFacets({})]);

        expect(fromPostgres.byTime).toEqual(fromMemory.byTime);
        expect(fromPostgres.byTime[0].tsBucket).toBe(5_000_000);
        expect(fromPostgres.byTime.length).toBeGreaterThan(1);
        expect(fromPostgres.byTime.reduce((n, b) => n + b.completed + b.failed + b.running, 0)).toBe(2);
    });

    it('searches the id for the text itself, not as a LIKE pattern', async () => {
        for (const store of [repo, mem]) await store.saveStimulation(stim('order-1', 'import-doc', 'running', {}));

        expect((await repo.queryRoster({ text: 'o_t' }, { limit: 10 })).rows).toEqual([]);
        expect((await repo.queryRoster({ text: 'no_att' }, { limit: 10 })).rows.map(r => r.stimulationId)).toEqual(['no_attempt']);
    });

    it('starts from the top on a cursor it cannot read', async () => {
        const page = await repo.queryRoster({}, { limit: 10, cursor: Buffer.from('garbage').toString('base64') });

        expect(page.rows.length).toBeGreaterThan(0);
    });

    it('keeps the roster fields right when attempts and the run checkpoint are written at the same time', async () => {
        const ids = Array.from({ length: 20 }, (_, i) => `race-${i}`);
        await Promise.all(
            ids.flatMap(id => [
                repo.saveAttempt(attempt(id, 5000, 'completed')),
                repo.saveStimulation(stim(id, 'import-doc', 'completed', {})),
            ])
        );

        const rows = (await repo.queryRoster({ text: 'race-' }, { limit: 50 })).rows;
        expect(rows).toHaveLength(20);
        for (const row of rows) {
            expect(row.startedAt).toBe(5000);
            expect(row.hopCount).toBe(2);
            expect(row.completedAt).toBe(5100);
        }
    });
});

d('retention racing a checkpoint (live Postgres)', () => {
    const prefix = `cnsret_${Date.now().toString(36)}_`;
    let pool: Pool;
    let now = 1_000_000;
    let repo: CNSPostgresStimulationRepository;

    beforeAll(() => {
        pool = new Pool({ connectionString: URL, max: 8 });
        repo = new CNSPostgresStimulationRepository({ pool, tablePrefix: prefix, now: () => now });
    });
    afterAll(async () => {
        await pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresStimulationSchema.tables(prefix), CNSPostgresStimulationSchema.migrationTable(prefix)].join(', ')} CASCADE`
        );
        await pool.end();
    });

    it('waits for a checkpoint that holds the run instead of deadlocking with it', async () => {
        await repo.saveStimulation(stim('stale', 'import-doc', 'running', {}));
        await repo.saveAttempt(attempt('stale', 1000, 'running'));
        now += 10_000;

        const checkpoint = await pool.connect();
        try {
            await checkpoint.query('BEGIN');
            await checkpoint.query('SELECT pg_advisory_xact_lock(7, hashtext($1))', [`${prefix}stale`]);
            await checkpoint.query(`UPDATE ${prefix}stimulation_attempt SET status = 'completed' WHERE stimulation_id = 'stale'`);
            const retention = repo.deleteStale(5_000);
            await new Promise(resolve => setTimeout(resolve, 500));
            await checkpoint.query(`UPDATE ${prefix}stimulation SET hop_count = 2 WHERE stimulation_id = 'stale'`);
            await checkpoint.query('COMMIT');

            await expect(retention).resolves.toBe(1);
        } finally {
            checkpoint.release();
        }
        expect(await repo.getAttempts('stale')).toEqual([]);
    });
});

d('retention over a large backlog (live Postgres)', () => {
    const prefix = `cnsbig_${Date.now().toString(36)}_`;
    let pool: Pool;
    let repo: CNSPostgresStimulationRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: URL });
        repo = new CNSPostgresStimulationRepository({ pool, tablePrefix: prefix });
        await repo.saveStimulation(stim('keep', 'import-doc', 'running', {}));
    });
    afterAll(async () => {
        await pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresStimulationSchema.tables(prefix), CNSPostgresStimulationSchema.migrationTable(prefix)].join(', ')} CASCADE`
        );
        await pool.end();
    });

    it('removes thousands of stale runs in batches', async () => {
        await pool.query(
            `INSERT INTO ${prefix}stimulation (stimulation_id, entry, status, progress, updated_at)
             SELECT 'old-' || n, '{}'::jsonb, 'completed', '{"tasks":[]}'::jsonb, 1 FROM generate_series(1, 7000) AS n`
        );
        await pool.query(
            `INSERT INTO ${prefix}stimulation_attempt (stimulation_attempt_id, stimulation_id, attempt_number, status, started_at, hop_count, has_error, entry)
             SELECT 'old-' || n || '#1', 'old-' || n, 1, 'completed', 1, 1, false, '[]'::jsonb FROM generate_series(1, 7000) AS n`
        );

        expect(await repo.deleteStale(60_000)).toBe(7000);
        expect((await repo.listStimulations()).map(s => s.stimulationId)).toEqual(['keep']);
        expect((await pool.query(`SELECT count(*)::int AS n FROM ${prefix}stimulation_attempt`)).rows[0].n).toBe(0);
    }, 60000);
});
