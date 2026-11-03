import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSInMemoryProgressRepository,
} from '@cnstra/persist';
import { createCNSWorker } from '.././worker';
import type {
    ICNSBullJob,
    ICNSBullWorkerLike,
    TCNSBullProcessor,
    TCNSStimulationJobData,
} from '.././types';

/**
 * A minimal in-memory stand-in for a BullMQ `Worker` that captures the processor
 * so a test can drive jobs through it. `run()` replays a job the way a BullMQ
 * retry would — SAME job id, incremented `attemptsMade` — so the worker's resume
 * path keys off the id.
 */
type TFakeWorkerOptions = { connection: string; concurrency?: number };

class FakeWorker implements ICNSBullWorkerLike {
    private readonly processor: TCNSBullProcessor<any>;
    readonly opts: TFakeWorkerOptions;
    constructor(
        _name: string,
        processor: TCNSBullProcessor<any>,
        opts: TFakeWorkerOptions
    ) {
        this.processor = processor;
        this.opts = opts;
    }
    async close(): Promise<void> {}
    on(): this {
        return this;
    }
    run(job: ICNSBullJob<TCNSStimulationJobData>): Promise<unknown> {
        return this.processor(job);
    }
}

// Two-step flow n1 → n2; n2 fails until `control.failStep2` is cleared. Same
// shape as the pg-boss worker test, driven through a BullMQ-style processor.
function buildFlow() {
    const input = cnsCollateral<{ id: number }>();
    const step1Out = cnsCollateral<{ id: number }>();
    const output = cnsCollateral<{ result: string }>();

    const ran: string[] = [];
    const control = { failStep2: true };

    const n1 = cnsNeuron({ step1Out }).dendrite({
        collateral: input,
        response: (p, axon) => {
            ran.push('n1');
            return axon.step1Out.createSignal({ id: p!.id });
        },
    });

    const n2 = cnsNeuron({ output }).dendrite({
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

const makeJob = (
    attemptsMade: number
): ICNSBullJob<TCNSStimulationJobData> => ({
    id: 'job-1',
    name: 'cns-stimulation',
    attemptsMade,
    data: { collateralName: 'input', payload: { id: 1 } },
});

test('resume: a retried job resumes the failed frontier instead of re-running from the entry', async () => {
    const { cns, registry, ran, control } = buildFlow();
    const repository = new CNSInMemoryProgressRepository();

    const worker = createCNSWorker({
        Worker: FakeWorker,
        workerOptions: { connection: 'fake-redis' },
        cns,
        registry,
        queue: 'cns',
        resume: { repository },
    }).worker;

    // First attempt fails; the outstanding frontier is persisted under the job id.
    await expect(worker.run(makeJob(0))).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2']);
    const saved = await repository.load('job-1');
    expect(saved?.tasks?.[0]?.neuronName).toBe('n2');

    // Fix the fault and re-run the SAME job id → resume: only n2 re-runs, n1 does not.
    control.failStep2 = false;
    await worker.run(makeJob(1));
    expect(ran).toEqual(['n1', 'n2', 'n2']);

    // Success drops the progress row (lifecycle = job row).
    expect(await repository.load('job-1')).toBeUndefined();
});

test('without resume, a retried job re-runs the whole flow from the entry signal', async () => {
    const { cns, registry, ran, control } = buildFlow();

    const worker = createCNSWorker({
        Worker: FakeWorker,
        workerOptions: { connection: 'fake-redis' },
        cns,
        registry,
        queue: 'cns',
    }).worker;

    await expect(worker.run(makeJob(0))).rejects.toBeDefined();
    expect(ran).toEqual(['n1', 'n2']);

    control.failStep2 = false;
    await worker.run(makeJob(1));
    // n1 runs again and n2 re-runs from scratch — no persisted frontier, so it is
    // a brand-new stimulation from the entry.
    expect(ran).toEqual(['n1', 'n2', 'n1', 'n2']);
});

test('resume via BullMQ NATIVE job progress (no external repository)', async () => {
    const { cns, registry, ran, control } = buildFlow();

    // No `resume.repository` → the checkpoint lives in the job's own progress.
    const worker = createCNSWorker({
        Worker: FakeWorker,
        workerOptions: { connection: 'fake-redis' },
        cns,
        registry,
        queue: 'cns',
        resume: {},
    }).worker;

    // One persistent job object (BullMQ carries progress across retries of the
    // same job in Redis; the fake stores it via updateProgress).
    const job: ICNSBullJob<TCNSStimulationJobData> & { progress: unknown } = {
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
    expect(ran).toEqual(['n1', 'n2']);
    expect(
        (job.progress as { tasks?: Array<{ neuronName?: string }> })?.tasks?.[0]
            ?.neuronName
    ).toBe('n2');

    // Fix the fault; the SAME job (progress carried) → resume only n2.
    control.failStep2 = false;
    await worker.run(job);
    expect(ran).toEqual(['n1', 'n2', 'n2']);
});

test('graceful shutdown stops taking new jobs and closes the worker', async () => {
    const { cns, registry } = buildFlow();
    const handle = createCNSWorker({
        Worker: FakeWorker,
        workerOptions: { connection: 'fake-redis' },
        cns,
        registry,
        queue: 'cns',
    });
    await handle.shutdown({ drainMs: 0 }); // nothing in-flight → resolves at once
    // while stopping, a newly-arriving job is rejected → BullMQ retries it later
    await expect(
        handle.worker.run(makeJob(0))
    ).rejects.toThrow(/shutting down/);
});

test('the Worker class receives workerOptions as its own options', () => {
    const { cns, registry } = buildFlow();
    const worker = createCNSWorker({
        Worker: FakeWorker,
        workerOptions: { connection: 'fake-redis', concurrency: 4 },
        cns,
        registry,
        queue: 'cns',
    }).worker;
    expect(worker.opts).toEqual({ connection: 'fake-redis', concurrency: 4 });
});

test('options the Worker class requires are required by createCNSWorker', () => {
    const { cns, registry } = buildFlow();
    const build = () =>
        createCNSWorker({
            Worker: FakeWorker,
            // @ts-expect-error connection is required by FakeWorker's options
            workerOptions: { concurrency: 4 },
            cns,
            registry,
            queue: 'cns',
        });
    const buildWithMisspeltOption = () =>
        createCNSWorker({
            Worker: FakeWorker,
            // @ts-expect-error concurency is not an option of FakeWorker
            workerOptions: { connection: 'fake-redis', concurency: 4 },
            cns,
            registry,
            queue: 'cns',
        });
    expect([build, buildWithMisspeltOption]).toHaveLength(2);
});
