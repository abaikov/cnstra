import { Pool } from 'pg';
import { CNSPostgresStimulationRepository } from '.././CNSPostgresStimulationRepository';
import { CNSPostgresStimulationSchema } from '.././schema/CNSPostgresStimulationSchema';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

// Live integration test — runs only when DATABASE_URL points at a reachable Postgres.
const URL = process.env.DATABASE_URL;
const d = URL ? describe : describe.skip;

// Each case does ~15 sequential live round-trips (schema create + CRUD); the 5s
// default is too tight under any DB contention. Generous timeout for live I/O.
jest.setTimeout(30000);

const sig = (collateralName: string, payload: unknown) => ({ collateralName, payload });

d('CNSPostgresStimulationRepository (live Postgres)', () => {
    const prefix = `cnstest_${Date.now().toString(36)}_`;
    let pool: Pool;
    let repo: CNSPostgresStimulationRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: URL });
        repo = new CNSPostgresStimulationRepository({ pool, tablePrefix: prefix });
    });
    afterAll(async () => {
        await pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresStimulationSchema.tables(prefix), CNSPostgresStimulationSchema.migrationTable(prefix)].join(', ')} CASCADE`
        );
        await pool.end();
    });

    test('stimulation → attempt → task round-trip, resume progress, delete cascade', async () => {
        const stimId = 'stim:import:42';
        const stim1: TCNSStimulationState = {
            stimulationId: stimId,
            entry: sig('input', { userId: '42' }),
            status: 'failed',
            progress: {
                tasks: [
                    {
                        neuronName: 'persistUser',
                        dendriteCollateralName: 'userEnriched',
                        input: sig('userEnriched', { id: '42', plan: 'pro' }),
                    },
                ],
            },
        };
        await repo.saveStimulation(stim1);
        const attempt1: TCNSStimulationAttempt = {
            stimulationAttemptId: 'stim:import:42#1',
            stimulationId: stimId,
            attemptNumber: 1,
            status: 'failed',
            startedAt: 1000,
            completedAt: 2000,
            hopCount: 3,
            hasError: true,
            replayOf: null,
            entry: [sig('input', { userId: '42' })],
        };
        await repo.saveAttempt(attempt1);
        const tasks: TCNSStimulationTask[] = [
            { stimulationAttemptId: 'stim:import:42#1', index: 1, neuronName: 'importUser', dendriteCollateralName: 'input', inputIndex: 0, output: sig('userFetched', { id: '42' }), status: 'done', error: null, startedAt: 1000, duration: 5 },
            { stimulationAttemptId: 'stim:import:42#1', index: 3, neuronName: 'persistUser', dendriteCollateralName: 'userEnriched', inputIndex: 2, output: null, status: 'failed', error: 'boom', startedAt: 1500, duration: null },
        ];
        for (const t of tasks) await repo.appendTask(t);

        // getStimulation rebuilds the normalised progress (frontier).
        const got = await repo.getStimulation(stimId);
        expect(got?.status).toBe('failed');
        expect(got?.entry).toEqual(sig('input', { userId: '42' }));
        expect(got?.progress.tasks.map(t => t.neuronName)).toEqual(['persistUser']);
        expect(got?.progress.tasks[0].input).toEqual(sig('userEnriched', { id: '42', plan: 'pro' }));

        // timeline + waterfall
        expect((await repo.getAttempts(stimId)).map(a => a.attemptNumber)).toEqual([1]);
        const wf = await repo.getTasks('stim:import:42#1');
        expect(wf.map(t => t.index)).toEqual([1, 3]);
        expect(wf[0].output).toEqual(sig('userFetched', { id: '42' }));
        expect(wf[1].status).toBe('failed');
        expect(wf[1].inputIndex).toBe(2);

        // attempt 2 resumes → completed, frontier REPLACED (empty)
        await repo.saveStimulation({ ...stim1, status: 'completed', progress: { tasks: [] } });
        await repo.saveAttempt({ ...attempt1, stimulationAttemptId: 'stim:import:42#2', attemptNumber: 2, status: 'completed', startedAt: 3000, completedAt: 4000, hopCount: 1, hasError: false });
        const got2 = await repo.getStimulation(stimId);
        expect(got2?.status).toBe('completed');
        expect(got2?.progress.tasks).toEqual([]); // frontier replaced
        expect((await repo.getAttempts(stimId)).map(a => a.attemptNumber)).toEqual([1, 2]);

        // delete cascades stimulation → attempts → tasks → frontier
        await repo.delete(stimId);
        expect(await repo.getStimulation(stimId)).toBeUndefined();
        expect(await repo.getAttempts(stimId)).toEqual([]);
        expect(await repo.getTasks('stim:import:42#1')).toEqual([]);
    });

    test('appendTask tolerates arriving BEFORE saveAttempt (persistor order)', async () => {
        const sid = 'stim:order';
        await repo.saveStimulation({ stimulationId: sid, entry: sig('input', {}), status: 'running', progress: { tasks: [] } });
        // The real persistor streams settled tasks as hops complete, BEFORE the
        // attempt marker is flushed — must not FK-fail.
        await repo.appendTask({ stimulationAttemptId: 'stim:order#1', index: 1, neuronName: 'importUser', dendriteCollateralName: 'input', inputIndex: 0, output: sig('userFetched', {}), status: 'done', error: null, startedAt: 1, duration: 1 });
        await repo.saveAttempt({ stimulationAttemptId: 'stim:order#1', stimulationId: sid, attemptNumber: 1, status: 'running', startedAt: 1, completedAt: null, hopCount: 1, hasError: false, replayOf: null, entry: [sig('input', {})] });
        expect((await repo.getTasks('stim:order#1')).map(t => t.index)).toEqual([1]);
        await repo.delete(sid);
        expect(await repo.getTasks('stim:order#1')).toEqual([]); // manual task cascade works
    });

    test('appendTask writes a redelivered task once and lands in a time partition that can be dropped', async () => {
        const at = 4_000_000_000_000;
        await pool.query(
            `CREATE TABLE ${prefix}stimulation_task_far PARTITION OF ${prefix}stimulation_task FOR VALUES FROM (${at}) TO (${at + 1000})`
        );
        const redelivered: TCNSStimulationTask = { stimulationAttemptId: 'stim:far#1', index: 1, neuronName: 'importUser', dendriteCollateralName: 'input', inputIndex: 0, output: null, status: 'done', error: null, startedAt: at, duration: 1 };
        await repo.appendTask(redelivered);
        await repo.appendTask(redelivered);

        expect((await pool.query(`SELECT count(*)::int AS n FROM ${prefix}stimulation_task_far`)).rows[0].n).toBe(1);
        await pool.query(`DROP TABLE ${prefix}stimulation_task_far`);
        expect(await repo.getTasks('stim:far#1')).toEqual([]);
    });

    test('listStimulations is newest-first', async () => {
        const mk = (id: string): TCNSStimulationState => ({
            stimulationId: id,
            entry: sig('input', {}),
            status: 'completed',
            progress: { tasks: [] },
        });
        await repo.saveStimulation(mk('A'));
        await new Promise(r => setTimeout(r, 15));
        await repo.saveStimulation(mk('B'));
        const ids = (await repo.listStimulations()).map(r => r.stimulationId);
        expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('A')); // B newer → first
        await repo.delete('A');
        await repo.delete('B');
    });

    test('scopeName round-trips and listStimulations filters by scope', async () => {
        const scoped: TCNSStimulationState = {
            stimulationId: 'scope:alpha:1',
            entry: sig('input', {}),
            status: 'completed',
            scopeName: 'alpha',
            progress: { tasks: [] },
        };
        const defaultScope: TCNSStimulationState = {
            stimulationId: 'scope:default:1',
            entry: sig('input', {}),
            status: 'completed',
            progress: { tasks: [] }, // no scopeName ⇒ default (NULL)
        };
        await repo.saveStimulation(scoped);
        await repo.saveStimulation(defaultScope);

        // round-trip: set scope comes back, default stays undefined
        expect((await repo.getStimulation('scope:alpha:1'))?.scopeName).toBe('alpha');
        expect((await repo.getStimulation('scope:default:1'))?.scopeName).toBeUndefined();

        // no filter ⇒ both returned
        const allIds = (await repo.listStimulations()).map(r => r.stimulationId);
        expect(allIds).toEqual(expect.arrayContaining(['scope:alpha:1', 'scope:default:1']));

        // filter by scope ⇒ only that scope (default NULL rows excluded)
        const alphaIds = (await repo.listStimulations({ scopeName: 'alpha' })).map(r => r.stimulationId);
        expect(alphaIds).toContain('scope:alpha:1');
        expect(alphaIds).not.toContain('scope:default:1');

        await repo.delete('scope:alpha:1');
        await repo.delete('scope:default:1');
    });

    test('deleteStale prunes stimulations by age, cascading attempts/tasks', async () => {
        const mk = (id: string): TCNSStimulationState => ({
            stimulationId: id, entry: sig('input', {}), status: 'completed',
            progress: { tasks: [] },
        });
        const att = (id: string): TCNSStimulationAttempt => ({
            stimulationAttemptId: `${id}#1`, stimulationId: id, attemptNumber: 1,
            status: 'completed', startedAt: 1, completedAt: 2, hopCount: 1,
            hasError: false, replayOf: null, entry: [sig('input', {})],
        });
        for (const id of ['ret:old', 'ret:fresh']) {
            await repo.saveStimulation(mk(id));
            await repo.saveAttempt(att(id));
        }
        // backdate the "old" run past the window
        await pool.query(
            `UPDATE ${prefix}stimulation SET updated_at = $1 WHERE stimulation_id = 'ret:old'`,
            [Date.now() - 2 * 60 * 60 * 1000]
        );

        // prune stale (older than 1h) → old goes (cascaded), fresh stays
        expect(await repo.deleteStale(60 * 60 * 1000)).toBe(1);
        expect((await repo.listStimulations()).map(r => r.stimulationId).filter(id => id.startsWith('ret:')))
            .toEqual(['ret:fresh']);
        expect(await repo.getAttempts('ret:old')).toEqual([]); // cascaded

        await repo.delete('ret:fresh');
    });

    test('deleteStale sweeps old attempts and tasks whose parent row never arrived', async () => {
        const old = Date.now() - 2 * 60 * 60 * 1000;
        await repo.saveAttempt({
            stimulationAttemptId: 'orphan#1', stimulationId: 'orphan', attemptNumber: 1,
            status: 'running', startedAt: old, completedAt: null, hopCount: 0,
            hasError: false, replayOf: null, entry: [sig('input', {})],
        });
        for (const [attemptId, startedAt] of [['lost#1', old], ['young#1', Date.now()]] as const) {
            await repo.appendTask({
                stimulationAttemptId: attemptId, index: 0, neuronName: 'n', dendriteCollateralName: 'c',
                inputIndex: 0, output: null, status: 'done', error: null, startedAt, duration: 1,
            });
        }

        await repo.deleteStale(60 * 60 * 1000);

        expect(await repo.getAttempts('orphan')).toEqual([]);
        expect(await repo.getTasks('lost#1')).toEqual([]);
        expect(await repo.getTasks('young#1')).toHaveLength(1);
    });

    test('deleteStale prepares the next days of task partitions and drops the days that ended before the window', async () => {
        const day = 24 * 60 * 60 * 1000;
        const base = Math.floor(3_000_000_000_000 / day) * day;
        let clock = base + day / 2;
        const clocked = new CNSPostgresStimulationRepository({ pool, tablePrefix: prefix, now: () => clock });
        const dayPartition = (start: number) => `${prefix}stimulation_task_p${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}`;
        const partitionOf = async (at: number) =>
            (await pool.query(`SELECT tableoid::regclass::text AS name FROM ${prefix}stimulation_task WHERE started_at = $1`, [at])).rows[0]?.name;

        await clocked.deleteStale(30 * day);
        const tomorrow: TCNSStimulationTask = {
            stimulationAttemptId: 'daily#1', index: 0, neuronName: 'n', dendriteCollateralName: 'c',
            inputIndex: 0, output: null, status: 'done', error: null, startedAt: base + day + 1, duration: 1,
        };
        await clocked.appendTask(tomorrow);
        await clocked.appendTask(tomorrow);
        expect(await partitionOf(base + day + 1)).toBe(dayPartition(base + day));
        expect(await clocked.getTasks('daily#1')).toHaveLength(1);

        clock = base + 3 * day;
        await clocked.deleteStale(day);

        expect(await clocked.getTasks('daily#1')).toEqual([]);
        expect((await pool.query('SELECT to_regclass($1) AS found', [dayPartition(base + day)])).rows[0].found).toBeNull();
        expect((await pool.query('SELECT to_regclass($1)::text AS found', [dayPartition(base + 9 * day)])).rows[0].found).not.toBeNull();
    });
});
