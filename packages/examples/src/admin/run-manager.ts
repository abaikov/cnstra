/**
 * DurableRunManager — the write/read side the retry-admin talks to.
 *
 * It owns ONE CNStra flow (importUser → enrichUser → persistUser) plus the
 * durable stores (repository + registry + serializer), and exposes the admin's
 * three actions plus a read:
 *
 *   launch({ userId, fail })   → start a fresh run (new id, attempt #1)
 *   clone(srcRunId)            → start a NEW run from an existing run's entry
 *   retry(runId)               → RESUME the outstanding frontier (attempt #n+1)
 *   snapshot()                 → the whole roster the UI renders
 *
 * Actions are transport-agnostic: `dispatch(cmd)` runs the command. By default
 * that is in-process (`handle`); the server can swap in a BullMQ transport so the
 * SAME commands flow through a real Redis queue — our admin, over a real broker.
 *
 * Execution is serialized through a tiny mutex so the per-attempt fault flag is
 * deterministic (no interleaving between concurrent runs in this demo).
 */
import { CNS, collateral, neuron, withCtx } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSProgressSerializer,
    CNSInMemoryStimulationRepository,
    CNSStimulationPersistor,
} from '@cnstra/persist';
import type { ICNSStimulationRepository } from '@cnstra/persist';

// ── the flow: importUser → enrichUser → persistUser ──
const input = collateral<{ userId: string }>();
const userFetched = collateral<{ id: string; name: string }>();
const userEnriched = collateral<{ id: string; name: string; plan: string }>();
const userSaved = collateral<{ id: string; ok: true }>();

// The fault the "db" injects, set per-attempt under the mutex.
let currentShouldFail = false;

const importUser = neuron({ userFetched }).dendrite({
    collateral: input,
    response: (p, axon) =>
        axon.userFetched.createSignal({ id: p!.userId, name: 'Neo Anderson' }),
});
const enrichUser = neuron({ userEnriched }).dendrite({
    collateral: userFetched,
    response: (p, axon) =>
        axon.userEnriched.createSignal({ ...p!, plan: 'pro' }),
});
const persistUser = withCtx<{ attempt: number }>()
    .neuron({ userSaved })
    .dendrite({
        collateral: userEnriched,
        response: (p, axon, ctx) => {
            ctx.set({ attempt: (ctx.get()?.attempt ?? 0) + 1 });
            if (currentShouldFail)
                throw new Error('boom: db connection timeout');
            return axon.userSaved.createSignal({ id: p!.id, ok: true });
        },
    });

/** A transport-agnostic admin command. */
export type TRunCommand =
    | { type: 'entry'; runId: string; userId: string; fail: boolean }
    | { type: 'resume'; runId: string };

export type TRunSummary = {
    runId: string;
    status: string;
    entry: { collateralName: string; payload: unknown };
    frontier: string[];
    attempts: Array<{
        attemptNumber: number;
        status: string;
        hopCount: number;
        tasks: Array<{
            index: number;
            neuronName: string;
            status: string;
            output: { collateralName: string; payload: unknown } | null;
            error: string | null;
        }>;
    }>;
};

export class DurableRunManager {
    private readonly cns = new CNS([importUser, enrichUser, persistUser]);
    private readonly registry = new CNSPersistOptionsRegistry();
    private readonly repository: ICNSStimulationRepository;
    private readonly serializer: CNSProgressSerializer;
    private readonly listeners = new Set<() => void>();
    private counter = 0;
    private chain: Promise<unknown> = Promise.resolve();
    /** Aborts whatever stimulation is in-flight so shutdown checkpoints cleanly. */
    private readonly abort = new AbortController();
    /** Runs a command; swapped by the server for a queue-backed transport. */
    private dispatch: (cmd: TRunCommand) => Promise<void> = cmd =>
        this.handle(cmd);

    constructor(
        repository: ICNSStimulationRepository = new CNSInMemoryStimulationRepository()
    ) {
        this.repository = repository;
        this.registry.register('importUser', importUser);
        this.registry.register('enrichUser', enrichUser);
        this.registry.register('persistUser', persistUser);
        this.registry.registerCollateral('input', input);
        this.serializer = new CNSProgressSerializer(this.registry);
    }

    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    private emit(): void {
        for (const cb of this.listeners) cb();
    }
    /** Route commands through a transport (e.g. a BullMQ queue). */
    setDispatch(fn: (cmd: TRunCommand) => Promise<void>): void {
        this.dispatch = fn;
    }

    // Run one task at a time so `currentShouldFail` is deterministic.
    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const next = this.chain.then(task, task);
        this.chain = next.catch(() => {});
        return next;
    }

    /** Execute a command in-process (the default transport + the queue worker). */
    async handle(cmd: TRunCommand): Promise<void> {
        if (cmd.type === 'entry')
            await this.runEntry(cmd.runId, cmd.userId, cmd.fail);
        else await this.resumeRun(cmd.runId);
        this.emit();
    }

    private async runEntry(
        runId: string,
        userId: string,
        fail: boolean
    ): Promise<void> {
        const entry = [{ collateralName: 'input', payload: { userId } }];
        await this.serialize(async () => {
            currentShouldFail = fail;
            const persistor = new CNSStimulationPersistor({
                repository: this.repository,
                registry: this.registry,
                stimulationId: runId,
                stimulationAttemptId: `${runId}#1`,
                attemptNumber: 1,
                entry,
                volume: 'full',
            });
            const stim = this.cns.stimulate(input.createSignal({ userId }), {
                onResponse: persistor.onResponse,
                abortSignal: this.abort.signal,
            });
            await stim.waitUntilComplete().catch(() => {});
            persistor.dispose();
        });
    }

    private async resumeRun(runId: string): Promise<void> {
        const run = await this.repository.getStimulation(runId);
        if (!run) throw new Error(`no such run: ${runId}`);
        const attempts = await this.repository.getAttempts(runId);
        const nextAttempt = attempts.length + 1;
        await this.serialize(async () => {
            // "The fault is fixed" — a retry from the admin clears it.
            currentShouldFail = false;
            const { tasks, ctx } = this.serializer.hydrate(run.progress);
            const persistor = new CNSStimulationPersistor({
                repository: this.repository,
                registry: this.registry,
                stimulationId: runId,
                stimulationAttemptId: `${runId}#${nextAttempt}`,
                attemptNumber: nextAttempt,
                entry: [run.entry],
                volume: 'full',
            });
            const stim = this.cns.activate(tasks, {
                ctx,
                onResponse: persistor.onResponse,
                abortSignal: this.abort.signal,
            });
            await stim.waitUntilComplete().catch(() => {});
            persistor.dispose();
        });
    }

    /**
     * Graceful shutdown: abort any in-flight stimulation (its remaining tasks
     * become the frontier) and wait for the serialized chain to settle so the
     * persistor's terminal flush writes that checkpoint. After this the run store
     * holds a resumable frontier — a persistent repository would survive restart.
     */
    async shutdown(): Promise<void> {
        this.abort.abort();
        await this.chain.catch(() => {});
    }

    // ── the three admin actions (transport-agnostic) ──

    /** Launch a brand-new run from scratch. */
    async launch(opts: { userId: string; fail: boolean }): Promise<string> {
        const runId = `run:import-user:${opts.userId}:${++this.counter}`;
        await this.dispatch({
            type: 'entry',
            runId,
            userId: opts.userId,
            fail: opts.fail,
        });
        return runId;
    }

    /** Clone an existing run: a fresh run from the same entry input (clean). */
    async clone(srcRunId: string): Promise<string> {
        const src = await this.repository.getStimulation(srcRunId);
        if (!src) throw new Error(`no such run: ${srcRunId}`);
        const userId = String(
            (src.entry.payload as { userId?: unknown })?.userId ?? 'unknown'
        );
        const runId = `run:import-user:${userId}:${++this.counter}`;
        await this.dispatch({ type: 'entry', runId, userId, fail: false });
        return runId;
    }

    /** Retry a failed run: resume its outstanding frontier. */
    async retry(runId: string): Promise<void> {
        await this.dispatch({ type: 'resume', runId });
    }

    async snapshot(): Promise<TRunSummary[]> {
        const out: TRunSummary[] = [];
        // listStimulations is newest-first; reverse to oldest-first so the UI's default
        // "select the last row" still lands on the newest run. Reading from the
        // repository (not a local array) is what makes a persistent store survive
        // a restart — the roster comes back from Postgres.
        const runs = (await this.repository.listStimulations()).reverse();
        for (const run of runs) {
            const runId = run.stimulationId;
            const attempts = await this.repository.getAttempts(runId);
            const attemptViews = [];
            for (const a of attempts) {
                const tasks = await this.repository.getTasks(a.stimulationAttemptId);
                attemptViews.push({
                    attemptNumber: a.attemptNumber,
                    status: a.status,
                    hopCount: a.hopCount,
                    tasks: tasks.map(t => ({
                        index: t.index,
                        neuronName: t.neuronName,
                        status: t.status,
                        output: t.output
                            ? {
                                  collateralName: t.output.collateralName,
                                  payload: t.output.payload,
                              }
                            : null,
                        error: t.error ?? null,
                    })),
                });
            }
            out.push({
                runId: run.stimulationId,
                status: run.status,
                entry: {
                    collateralName: run.entry.collateralName,
                    payload: run.entry.payload,
                },
                frontier: run.progress.tasks.map(t => t.neuronName),
                attempts: attemptViews,
            });
        }
        return out;
    }
}
