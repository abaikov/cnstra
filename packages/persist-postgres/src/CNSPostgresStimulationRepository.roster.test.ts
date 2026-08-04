import { Pool } from 'pg';
import { CNSPostgresStimulationRepository } from './CNSPostgresStimulationRepository';
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
    progress: { tasks: [], context: {} },
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
        for (const t of [
            'task',
            'stimulation_attempt',
            'stimulation_frontier',
            'stimulation_context',
            'stimulation',
        ])
            await pool.query(`DROP TABLE IF EXISTS ${prefix}${t} CASCADE`);
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
});
