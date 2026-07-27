import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSInMemoryProgressRepository,
} from '@cnstra/persist';
import { createCNSWorker } from './worker';
import type { IPgBossJob, IPgBossLike, TCNSStimulationJobData } from './types';

/**
 * A minimal in-memory stand-in for pg-boss that captures the registered handler
 * so a test can drive jobs through it. `run()` replays a job the way a retry
 * would — same job id, so the worker's resume path keys off it.
 */
class FakeBoss implements IPgBossLike {
    private handler?: (jobs: IPgBossJob<any>[]) => Promise<unknown>;

    async send(): Promise<string | null> {
        return 'job-id';
    }

    work<TData extends object>(
        _name: string,
        optsOrHandler:
            | Record<string, unknown>
            | ((jobs: IPgBossJob<TData>[]) => Promise<unknown>),
        maybeHandler?: (jobs: IPgBossJob<TData>[]) => Promise<unknown>
    ): Promise<string> {
        this.handler = (maybeHandler ?? optsOrHandler) as (
            jobs: IPgBossJob<any>[]
        ) => Promise<unknown>;
        return Promise.resolve('worker-id');
    }

    run(job: IPgBossJob<TCNSStimulationJobData>): Promise<unknown> {
        if (!this.handler) throw new Error('no handler registered');
        return this.handler([job]);
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

    const n2 = withCtx<{ attempt: number }>()
        .neuron({ output })
        .dendrite({
            collateral: step1Out,
            response: (p, axon, ctx) => {
                const attempt = (ctx.get()?.attempt ?? 0) + 1;
                ctx.set({ attempt });
                ran.push(`n2#${attempt}`);
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

const JOB: IPgBossJob<TCNSStimulationJobData> = {
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
    expect(ran).toEqual(['n1', 'n2#1']);
    const saved = await repository.load('job-1');
    expect(saved?.tasks?.[0]?.neuronName).toBe('n2');

    // Fix the fault and re-run the SAME job id → resume: only n2 re-runs, n1 does not.
    control.failStep2 = false;
    await boss.run(JOB);
    expect(ran).toEqual(['n1', 'n2#1', 'n2#2']);

    // Success drops the progress row (lifecycle = job row).
    expect(await repository.load('job-1')).toBeUndefined();
});

test('without resume, a retried job re-runs the whole flow from the entry signal', async () => {
    const { cns, registry, ran, control } = buildFlow();
    const boss = new FakeBoss();

    await createCNSWorker({ boss, cns, registry, queue: 'cns' });

    await expect(boss.run(JOB)).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2#1']);

    control.failStep2 = false;
    await boss.run(JOB);
    // n1 runs again and n2's context resets (attempt back to 1) — no persisted
    // frontier or context, so it is a brand-new stimulation from the entry.
    expect(ran).toEqual(['n1', 'n2#1', 'n1', 'n2#1']);
});
