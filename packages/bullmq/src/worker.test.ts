import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSInMemoryProgressRepository,
} from '@cnstra/persist';
import { createCNSWorker } from './worker';
import type {
    IBullJob,
    IBullWorkerCtor,
    IBullWorkerLike,
    TBullProcessor,
    TCNSStimulationJobData,
} from './types';

/**
 * A minimal in-memory stand-in for a BullMQ `Worker` that captures the processor
 * so a test can drive jobs through it. `run()` replays a job the way a BullMQ
 * retry would — SAME job id, incremented `attemptsMade` — so the worker's resume
 * path keys off the id.
 */
class FakeWorker implements IBullWorkerLike {
    private readonly processor: TBullProcessor<any>;
    constructor(
        _name: string,
        processor: TBullProcessor<any>,
        _opts?: Record<string, unknown>
    ) {
        this.processor = processor;
    }
    async close(): Promise<void> {}
    on(): this {
        return this;
    }
    run(job: IBullJob<TCNSStimulationJobData>): Promise<unknown> {
        return this.processor(job);
    }
}

// Two-step flow n1 → n2; n2 fails until `control.failStep2` is cleared. Same
// shape as the pg-boss worker test, driven through a BullMQ-style processor.
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

const makeJob = (
    attemptsMade: number
): IBullJob<TCNSStimulationJobData> => ({
    id: 'job-1',
    name: 'cns-stimulation',
    attemptsMade,
    data: { collateralName: 'input', payload: { id: 1 } },
});

test('resume: a retried job resumes the failed frontier instead of re-running from the entry', async () => {
    const { cns, registry, ran, control } = buildFlow();
    const repository = new CNSInMemoryProgressRepository();

    const worker = createCNSWorker({
        Worker: FakeWorker as unknown as IBullWorkerCtor,
        cns,
        registry,
        queue: 'cns',
        resume: { repository },
    }) as unknown as FakeWorker;

    // First attempt fails; the outstanding frontier is persisted under the job id.
    await expect(worker.run(makeJob(0))).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2#1']);
    const saved = await repository.load('job-1');
    expect(saved?.tasks?.[0]?.neuronName).toBe('n2');

    // Fix the fault and re-run the SAME job id → resume: only n2 re-runs, n1 does not.
    control.failStep2 = false;
    await worker.run(makeJob(1));
    expect(ran).toEqual(['n1', 'n2#1', 'n2#2']);

    // Success drops the progress row (lifecycle = job row).
    expect(await repository.load('job-1')).toBeUndefined();
});

test('without resume, a retried job re-runs the whole flow from the entry signal', async () => {
    const { cns, registry, ran, control } = buildFlow();

    const worker = createCNSWorker({
        Worker: FakeWorker as unknown as IBullWorkerCtor,
        cns,
        registry,
        queue: 'cns',
    }) as unknown as FakeWorker;

    await expect(worker.run(makeJob(0))).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2#1']);

    control.failStep2 = false;
    await worker.run(makeJob(1));
    // n1 runs again and n2's context resets (attempt back to 1) — no persisted
    // frontier or context, so it is a brand-new stimulation from the entry.
    expect(ran).toEqual(['n1', 'n2#1', 'n1', 'n2#1']);
});

test('resume via BullMQ NATIVE job progress (no external repository)', async () => {
    const { cns, registry, ran, control } = buildFlow();

    // No `resume.repository` → the checkpoint lives in the job's own progress.
    const worker = createCNSWorker({
        Worker: FakeWorker as unknown as IBullWorkerCtor,
        cns,
        registry,
        queue: 'cns',
        resume: {},
    }) as unknown as FakeWorker;

    // One persistent job object (BullMQ carries progress across retries of the
    // same job in Redis; the fake stores it via updateProgress).
    const job: IBullJob<TCNSStimulationJobData> & { progress: unknown } = {
        id: 'job-1',
        name: 'cns-stimulation',
        data: { collateralName: 'input', payload: { id: 1 } },
        progress: undefined,
    };
    job.updateProgress = async (v: number | object) => {
        job.progress = v;
    };

    // Attempt 1 fails → the frontier is written to job.progress (not a side store).
    await expect(worker.run(job)).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2#1']);
    expect(
        (job.progress as { tasks?: Array<{ neuronName?: string }> })?.tasks?.[0]
            ?.neuronName
    ).toBe('n2');

    // Fix the fault; the SAME job (progress carried) → resume only n2.
    control.failStep2 = false;
    await worker.run(job);
    expect(ran).toEqual(['n1', 'n2#1', 'n2#2']);
});
