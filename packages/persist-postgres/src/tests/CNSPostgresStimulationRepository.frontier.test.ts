import { Pool } from 'pg';
import { CNSPostgresStimulationRepository } from '.././CNSPostgresStimulationRepository';
import { CNSPostgresStimulationSchema } from '.././schema/CNSPostgresStimulationSchema';
import type { ICNSPgQueryable } from '.././interfaces/ICNSPgQueryable';
import type { TCNSStimulationState } from '@cnstra/persist-dto';

const URL = process.env.DATABASE_URL;
const d = URL ? describe : describe.skip;

jest.setTimeout(30000);

const sig = (collateralName: string, payload: unknown) => ({
    collateralName,
    payload,
});

const frontierOf = (n: number): TCNSStimulationState => ({
    stimulationId: 'stim:wide',
    entry: sig('input', { n }),
    status: 'running',
    progress: {
        tasks: Array.from({ length: n }, (_, i) => ({
            neuronName: `neuron${i}`,
            dendriteCollateralName: `collateral${i}`,
            input: i % 2 === 0 ? sig(`collateral${i}`, { i }) : undefined,
        })),
    },
});

describe('migration needs a pool', () => {
    it('refuses to migrate through a bare queryable', () => {
        expect(() => new CNSPostgresStimulationRepository({ queryable: { query: async () => ({ rows: [] }) } })).toThrow(
            'cannot hold the migration transaction'
        );
    });
});

describe('saveStimulation statement count', () => {
    const countingRepo = () => {
        const sql: string[] = [];
        const queryable: ICNSPgQueryable = {
            query: async (text: string) => {
                sql.push(text);
                return { rows: [] };
            },
        };
        const repo = new CNSPostgresStimulationRepository({
            queryable,
            autoMigrate: false,
        });
        return { repo, sql };
    };

    it('writes a checkpoint in the same statements whatever the width of the frontier', async () => {
        const one = countingRepo();
        await one.repo.saveStimulation(frontierOf(0));

        const many = countingRepo();
        await many.repo.saveStimulation(frontierOf(200));

        expect(many.sql).toHaveLength(one.sql.length);
        expect(many.sql).toHaveLength(3);
    });
});

d('saveStimulation frontier round-trip (live Postgres)', () => {
    const prefix = `cnsfront_${Date.now().toString(36)}_`;
    let pool: Pool;
    let repo: CNSPostgresStimulationRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: URL });
        repo = new CNSPostgresStimulationRepository({
            pool,
            tablePrefix: prefix,
        });
    });
    afterAll(async () => {
        await pool.query(
            `DROP TABLE IF EXISTS ${[...CNSPostgresStimulationSchema.tables(prefix), CNSPostgresStimulationSchema.migrationTable(prefix)].join(', ')} CASCADE`
        );
        await pool.end();
    });

    it('keeps order and inputs across a whole frontier', async () => {
        const state = frontierOf(25);
        await repo.saveStimulation(state);

        const got = await repo.getStimulation('stim:wide');
        expect(got?.progress.tasks.map(t => t.neuronName)).toEqual(
            state.progress.tasks.map(t => t.neuronName)
        );
        expect(got?.progress.tasks[0].input).toEqual(sig('collateral0', { i: 0 }));
        expect(got?.progress.tasks[1].input ?? null).toBeNull();
        expect(got?.progress.tasks[24].input).toEqual(
            sig('collateral24', { i: 24 })
        );
    });

    it('replaces a wide frontier with a narrow one', async () => {
        await repo.saveStimulation(frontierOf(25));
        await repo.saveStimulation(frontierOf(2));

        const got = await repo.getStimulation('stim:wide');
        expect(got?.progress.tasks.map(t => t.neuronName)).toEqual([
            'neuron0',
            'neuron1',
        ]);
    });

    it('brings back the run context, the modality and every task context a resume needs', async () => {
        const state: TCNSStimulationState = {
            stimulationId: 'stim:context',
            entry: sig('input', {}),
            status: 'running',
            progress: {
                tasks: [
                    {
                        neuronName: 'charge',
                        dendriteCollateralName: 'charge.requested',
                        input: sig('charge.requested', { orderId: 'o1' }),
                        activationContext: { attempt: '2' },
                    },
                ],
                stimulationContext: { traceparent: '00-abc-def-01' },
                modalityName: 'web',
                afferentPathName: 'checkout',
            },
        };
        await repo.saveStimulation(state);

        expect((await repo.getStimulation('stim:context'))?.progress).toEqual(state.progress);
        expect((await repo.listStimulations()).find(s => s.stimulationId === 'stim:context')?.progress).toEqual(state.progress);
    });

    it('keeps the activation context of a settled task', async () => {
        await repo.appendTask({
            stimulationAttemptId: 'stim:context#1',
            index: 0,
            neuronName: 'charge',
            dendriteCollateralName: 'charge.requested',
            inputIndex: 0,
            output: null,
            status: 'done',
            error: null,
            startedAt: 1,
            duration: 3_000_000_000,
            activationContext: { attempt: '2' },
        });

        const [task] = await repo.getTasks('stim:context#1');
        expect(task.activationContext).toEqual({ attempt: '2' });
        expect(task.duration).toBe(3_000_000_000);
    });
});
