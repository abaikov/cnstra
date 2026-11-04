import { CNS, collateral, neuron } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSInMemoryProgressRepository,
} from '@cnstra/persist';
import { runCNSDevToolsAction } from '@cnstra/persist-dto';
import { createCNSWorker } from '.././worker';
import type { ICNSPgBossJob, ICNSPgBossLike, TCNSStimulationJobData } from '.././types';

/**
 * A minimal in-memory stand-in for pg-boss that captures the registered handler
 * so a test can drive jobs through it. `run()` replays a job the way a retry
 * would — same job id, so the worker's resume path keys off it.
 */
class FakeBoss implements ICNSPgBossLike {
    private handler?: (jobs: ICNSPgBossJob<any>[]) => Promise<unknown>;
    /** Ids the worker settled itself, in call order. */
    readonly completed: string[][] = [];

    async send(): Promise<string | null> {
        return 'job-id';
    }

    async complete(_name: string, ids: string[]): Promise<unknown> {
        this.completed.push([...ids]);
        return undefined;
    }

    readonly retried: Array<{ name: string; id: string }> = [];

    async getJobById(_name: string, id: string): Promise<{ id: string }> {
        return { id };
    }

    async retry(name: string, id: string): Promise<unknown> {
        this.retried.push({ name, id });
        return undefined;
    }

    work<TData extends object>(
        _name: string,
        optsOrHandler:
            | Record<string, unknown>
            | ((jobs: ICNSPgBossJob<TData>[]) => Promise<unknown>),
        maybeHandler?: (jobs: ICNSPgBossJob<TData>[]) => Promise<unknown>
    ): Promise<string> {
        this.handler = (maybeHandler ?? optsOrHandler) as (
            jobs: ICNSPgBossJob<any>[]
        ) => Promise<unknown>;
        return Promise.resolve('worker-id');
    }

    run(job: ICNSPgBossJob<TCNSStimulationJobData>): Promise<unknown> {
        if (!this.handler) throw new Error('no handler registered');
        return this.handler([job]);
    }

    /** Drive a whole batch, the way pg-boss does with `batchSize > 1`. */
    runBatch(jobs: ICNSPgBossJob<TCNSStimulationJobData>[]): Promise<unknown> {
        if (!this.handler) throw new Error('no handler registered');
        return this.handler(jobs);
    }
}

// Two-step flow n1 → n2; n2 fails until `control.failStep2` is cleared. Same
// shape as the persist serializer test, driven through the worker instead.
function buildFlow() {
    const input = collateral<{ id: number }>();
    const step1Out = collateral<{ id: number }>();
    const output = collateral<{ result: string }>();

    const ran: string[] = [];
    const control = { failStep2: true };

    const n1 = neuron({ step1Out }).dendrite({
        collateral: input,
        response: (p, axon) => {
            ran.push('n1');
            return axon.step1Out.createSignal({ id: p!.id });
        },
    });

    const n2 = neuron({ output }).dendrite({
        collateral: step1Out,
        response: (p, axon) => {
            ran.push(`n2`);
                if (control.failStep2) throw new Error('boom');
                return axon.output.createSignal({ result: `ok-${p!.id}` });
            },
        });

    const cns = new CNS([n1, n2]);

    const registry = new CNSPersistOptionsRegistry();
    registry.register('n1', n1);
    registry.register('n2', n2);
    registry.registerCollateral('input', input);

    return { cns, registry, ran, control };
}

const JOB: ICNSPgBossJob<TCNSStimulationJobData> = {
    id: 'job-1',
    name: 'cns',
    data: { collateralName: 'input', payload: { id: 1 } },
};

test('resume: a retried job resumes the failed frontier instead of re-running from the entry', async () => {
    const { cns, registry, ran, control } = buildFlow();
    const boss = new FakeBoss();
    const repository = new CNSInMemoryProgressRepository();

    await createCNSWorker({
        boss,
        cns,
        registry,
        queue: 'cns',
        resume: { repository },
    });

    // First attempt fails; the outstanding frontier is persisted under the job id.
    await expect(boss.run(JOB)).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2']);
    const saved = await repository.load('job-1');
    expect(saved?.tasks?.[0]?.neuronName).toBe('n2');

    // Fix the fault and re-run the SAME job id → resume: only n2 re-runs, n1 does not.
    control.failStep2 = false;
    await boss.run(JOB);
    expect(ran).toEqual(['n1', 'n2', 'n2']);

    // Success drops the progress row (lifecycle = job row).
    expect(await repository.load('job-1')).toBeUndefined();
});

test('without resume, a retried job re-runs the whole flow from the entry signal', async () => {
    const { cns, registry, ran, control } = buildFlow();
    const boss = new FakeBoss();

    await createCNSWorker({ boss, cns, registry, queue: 'cns' });

    await expect(boss.run(JOB)).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2']);

    control.failStep2 = false;
    await boss.run(JOB);
    // n1 runs again and n2 re-runs from scratch — no persisted frontier, so it is
    // a brand-new stimulation from the entry.
    expect(ran).toEqual(['n1', 'n2', 'n1', 'n2']);
});

test('graceful shutdown stops taking new jobs', async () => {
    const { cns, registry } = buildFlow();
    const boss = new FakeBoss();
    const handle = await createCNSWorker({ boss, cns, registry, queue: 'cns' });
    await handle.shutdown({ drainMs: 0 }); // nothing in-flight → resolves at once
    // a job arriving during/after shutdown is rejected → pg-boss retries it later
    await expect(boss.run(JOB)).rejects.toThrow(/shutting down/);
});

/**
 * A batch is settled by pg-boss as ONE unit: a handler that throws fails every id
 * in it. That made one bad job cost twice — the jobs behind it never ran, and the
 * jobs ahead of it ran a second time on the retry. These pin both halves.
 */
describe('a failing job does not take its batch down with it', () => {
    /** Flow whose single neuron fails for the payload ids listed in `fail`. */
    const buildBatchFlow = (fail: number[]) => {
        const input = collateral<{ id: number }>();
        const done = collateral<{ id: number }>();
        const ran: number[] = [];

        const n = neuron({ done }).dendrite({
            collateral: input,
            response: (p, axon) => {
                ran.push(p!.id);
                if (fail.includes(p!.id)) throw new Error(`boom-${p!.id}`);
                return axon.done.createSignal({ id: p!.id });
            },
        });

        const registry = new CNSPersistOptionsRegistry();
        registry.register('n', n);
        registry.registerCollateral('input', input);
        return { cns: new CNS([n]), registry, ran };
    };

    const batch = (ids: number[]): ICNSPgBossJob<TCNSStimulationJobData>[] =>
        ids.map(id => ({
            id: `job-${id}`,
            name: 'cns',
            data: { collateralName: 'input', payload: { id } },
        }));

    it('runs every job in the batch, including the ones after the failure', async () => {
        const { cns, registry, ran } = buildBatchFlow([3]);
        const boss = new FakeBoss();
        await createCNSWorker({ boss, cns, registry, queue: 'cns' });

        await expect(boss.runBatch(batch([1, 2, 3, 4, 5]))).rejects.toBeDefined();

        // The whole batch ran — job 3 failing must not swallow 4 and 5.
        expect(ran).toEqual([1, 2, 3, 4, 5]);
    });

    it('completes the jobs that succeeded so the retry does not re-run them', async () => {
        const { cns, registry } = buildBatchFlow([3]);
        const boss = new FakeBoss();
        await createCNSWorker({ boss, cns, registry, queue: 'cns' });

        await expect(boss.runBatch(batch([1, 2, 3, 4, 5]))).rejects.toBeDefined();

        // Everything but the failure is settled here; pg-boss's fail-by-id only
        // touches rows below `completed`, so these keep their result.
        expect(boss.completed).toEqual([['job-1', 'job-2', 'job-4', 'job-5']]);
    });

    it('still reports the failure, so the failed job itself is retried', async () => {
        const { cns, registry } = buildBatchFlow([2]);
        const boss = new FakeBoss();
        await createCNSWorker({ boss, cns, registry, queue: 'cns' });

        await expect(boss.runBatch(batch([1, 2]))).rejects.toThrow(
            /failed task/
        );
    });

    it('reports every failure when more than one job in the batch fails', async () => {
        const { cns, registry } = buildBatchFlow([2, 4]);
        const boss = new FakeBoss();
        await createCNSWorker({ boss, cns, registry, queue: 'cns' });

        const err = (await boss
            .runBatch(batch([1, 2, 3, 4]))
            .catch((e: unknown) => e)) as Error & { errors?: unknown[] };
        expect(err.message).toMatch(/2 of 4 jobs failed/);
        expect(err.errors).toHaveLength(2);
        expect(boss.completed).toEqual([['job-1', 'job-3']]);
    });

    it('a whole batch that succeeds is left for pg-boss to settle', async () => {
        const { cns, registry } = buildBatchFlow([]);
        const boss = new FakeBoss();
        await createCNSWorker({ boss, cns, registry, queue: 'cns' });

        await boss.runBatch(batch([1, 2, 3]));

        // No self-settlement: pg-boss completes the batch itself, and doing it
        // twice is a wasted round trip.
        expect(boss.completed).toEqual([]);
    });

    it('a single-job batch behaves exactly as before', async () => {
        const { cns, registry } = buildBatchFlow([1]);
        const boss = new FakeBoss();
        await createCNSWorker({ boss, cns, registry, queue: 'cns' });

        await expect(boss.runBatch(batch([1]))).rejects.toThrow(/failed task/);
        expect(boss.completed).toEqual([]);
    });
});

describe('the worker handle', () => {
    it('names its cns, registry and queue', async () => {
        const { cns, registry } = buildFlow();
        const handle = await createCNSWorker({ boss: new FakeBoss(), cns, registry, queue: 'orders' });
        expect(handle.cns).toBe(cns);
        expect(handle.registry).toBe(registry);
        expect(handle.queue).toBe('orders');
    });

    it('builds the DevTools actions against its own boss and queue', async () => {
        const { cns, registry } = buildFlow();
        const boss = new FakeBoss();
        const handle = await createCNSWorker({ boss, cns, registry, queue: 'orders' });

        const handled = await runCNSDevToolsAction([handle.actions()], {
            type: 'resume',
            requestId: 'request-1',
            stimulationId: 'job-1',
            stimulationAttemptId: 'job-1#2',
            attemptNumber: 2,
            entry: { collateralName: 'input', payload: { id: 1 } },
            progress: { tasks: [] },
        });

        expect(handled).toBe(true);
        expect(boss.retried).toEqual([{ name: 'orders', id: 'job-1' }]);
    });
});
