import { Pool } from 'pg';
import { CNSPostgresStimulationRepository } from './CNSPostgresStimulationRepository';
import type {
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
    TCNSStimulationTaskPersisted,
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

    test('stimulation → attempt → task round-trip, resume progress, delete cascade', async () => {
        const stimId = 'run:import:42';
        const stim1: TCNSStimulationPersisted = {
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
                context: { persistUser: { attempt: 1 } },
            },
        };
        await repo.saveStimulation(stim1);
        const attempt1: TCNSStimulationAttemptPersisted = {
            stimulationAttemptId: 'run:import:42#1',
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
        const tasks: TCNSStimulationTaskPersisted[] = [
            { stimulationAttemptId: 'run:import:42#1', index: 1, neuronName: 'importUser', dendriteCollateralName: 'input', inputIndex: 0, output: sig('userFetched', { id: '42' }), status: 'done', error: null, startedAt: 1000, duration: 5 },
            { stimulationAttemptId: 'run:import:42#1', index: 3, neuronName: 'persistUser', dendriteCollateralName: 'userEnriched', inputIndex: 2, output: null, status: 'failed', error: 'boom', startedAt: 1500, duration: null },
        ];
        for (const t of tasks) await repo.appendTask(t);

        // getStimulation rebuilds the normalised progress (frontier + context).
        const got = await repo.getStimulation(stimId);
        expect(got?.status).toBe('failed');
        expect(got?.entry).toEqual(sig('input', { userId: '42' }));
        expect(got?.progress.tasks.map(t => t.neuronName)).toEqual(['persistUser']);
        expect(got?.progress.tasks[0].input).toEqual(sig('userEnriched', { id: '42', plan: 'pro' }));
        expect(got?.progress.context).toEqual({ persistUser: { attempt: 1 } });

        // timeline + waterfall
        expect((await repo.getAttempts(stimId)).map(a => a.attemptNumber)).toEqual([1]);
        const wf = await repo.getTasks('run:import:42#1');
        expect(wf.map(t => t.index)).toEqual([1, 3]);
        expect(wf[0].output).toEqual(sig('userFetched', { id: '42' }));
        expect(wf[1].status).toBe('failed');
        expect(wf[1].inputIndex).toBe(2);

        // attempt 2 resumes → completed, frontier REPLACED (empty)
        await repo.saveStimulation({ ...stim1, status: 'completed', progress: { tasks: [], context: { persistUser: { attempt: 2 } } } });
        await repo.saveAttempt({ ...attempt1, stimulationAttemptId: 'run:import:42#2', attemptNumber: 2, status: 'completed', startedAt: 3000, completedAt: 4000, hopCount: 1, hasError: false });
        const got2 = await repo.getStimulation(stimId);
        expect(got2?.status).toBe('completed');
        expect(got2?.progress.tasks).toEqual([]); // frontier replaced
        expect(got2?.progress.context).toEqual({ persistUser: { attempt: 2 } });
        expect((await repo.getAttempts(stimId)).map(a => a.attemptNumber)).toEqual([1, 2]);

        // delete cascades stimulation → attempts → tasks → frontier/context
        await repo.delete(stimId);
        expect(await repo.getStimulation(stimId)).toBeUndefined();
        expect(await repo.getAttempts(stimId)).toEqual([]);
        expect(await repo.getTasks('run:import:42#1')).toEqual([]);
    });

    test('appendTask tolerates arriving BEFORE saveAttempt (persistor order)', async () => {
        const sid = 'run:order';
        await repo.saveStimulation({ stimulationId: sid, entry: sig('input', {}), status: 'running', progress: { tasks: [], context: {} } });
        // The real persistor streams settled tasks as hops complete, BEFORE the
        // attempt marker is flushed — must not FK-fail.
        await repo.appendTask({ stimulationAttemptId: 'run:order#1', index: 1, neuronName: 'importUser', dendriteCollateralName: 'input', inputIndex: 0, output: sig('userFetched', {}), status: 'done', error: null, startedAt: 1, duration: 1 });
        await repo.saveAttempt({ stimulationAttemptId: 'run:order#1', stimulationId: sid, attemptNumber: 1, status: 'running', startedAt: 1, completedAt: null, hopCount: 1, hasError: false, replayOf: null, entry: [sig('input', {})] });
        expect((await repo.getTasks('run:order#1')).map(t => t.index)).toEqual([1]);
        await repo.delete(sid);
        expect(await repo.getTasks('run:order#1')).toEqual([]); // manual task cascade works
    });

    test('listStimulations is newest-first', async () => {
        const mk = (id: string): TCNSStimulationPersisted => ({
            stimulationId: id,
            entry: sig('input', {}),
            status: 'completed',
            progress: { tasks: [], context: {} },
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
        const scoped: TCNSStimulationPersisted = {
            stimulationId: 'scope:alpha:1',
            entry: sig('input', {}),
            status: 'completed',
            scopeName: 'alpha',
            progress: { tasks: [], context: {} },
        };
        const defaultScope: TCNSStimulationPersisted = {
            stimulationId: 'scope:default:1',
            entry: sig('input', {}),
            status: 'completed',
            progress: { tasks: [], context: {} }, // no scopeName ⇒ default (NULL)
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
});
