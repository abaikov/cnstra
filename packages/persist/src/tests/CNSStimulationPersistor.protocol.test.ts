import { CNS, cnsCollateral, cnsNeuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '.././CNSPersistOptionsRegistry';
import { CNSStimulationPersistor } from '.././CNSStimulationPersistor';
import type { ICNSStimulationWriter } from '.././interfaces/ICNSStimulationRepository';
import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

/**
 * The CONTRACT a writer is driven by — the call sequence, not the contents.
 *
 * Every sink (the devtools transport, Postgres, the OTel exporter) is written
 * against this order, and a sink that assumes a different one silently drops
 * records. That failure is invisible to the sink's own unit tests, because those
 * test the sink against whatever order their fixtures assume. So it is pinned
 * here, once, against the real persistor.
 */

const ENTRY = [{ collateralName: 'input', payload: { id: 1 } }];

/** Records the ORDER of calls and the identity of what each one carried. */
const recordingWriter = () => {
    const calls: string[] = [];
    const tasks: TCNSStimulationTask[] = [];
    const attempts: TCNSStimulationAttempt[] = [];

    const writer: ICNSStimulationWriter = {
        async saveStimulation(_stimulation: TCNSStimulationState) {
            calls.push('saveStimulation');
        },
        async saveAttempt(attempt) {
            calls.push(`saveAttempt:${attempt.status}`);
            attempts.push(attempt);
        },
        async appendTask(task) {
            calls.push(`appendTask:${task.index}`);
            tasks.push(task);
        },
        async getStimulation() {
            calls.push('getStimulation');
            return undefined;
        },
    };

    return { writer, calls, tasks, attempts };
};

function buildFlow() {
    const input = cnsCollateral<{ id: number }>();
    const mid = cnsCollateral<{ id: number }>();
    const out = cnsCollateral<{ result: string }>();

    const first = cnsNeuron({ mid }).dendrite({
        collateral: input,
        response: (p, axon) => axon.mid.createSignal({ id: p!.id }),
    });
    const second = cnsNeuron({ out }).dendrite({
        collateral: mid,
        response: (p, axon) => axon.out.createSignal({ result: `ok-${p!.id}` }),
    });

    const cns = new CNS([first, second]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('first', first);
    registry.register('second', second);
    registry.registerCollateral('input', input);
    return { cns, registry, input };
}

const run = async () => {
    const { cns, registry, input } = buildFlow();
    const sink = recordingWriter();

    const persistor = new CNSStimulationPersistor({
        repository: sink.writer,
        registry,
        stimulationId: 'run-1',
        stimulationAttemptId: 'run-1#1',
        attemptNumber: 1,
        entry: ENTRY,
        volume: 'full',
    });

    const stimulation = cns.stimulate(input.createSignal({ id: 1 }), {
        onResponse: persistor.onResponse,
    });
    await stimulation.waitUntilComplete().catch(() => {});
    // The terminal flush is fired without being awaited by the engine.
    await new Promise(resolve => setTimeout(resolve, 20));
    persistor.dispose();

    return sink;
};

test('tasks are appended BEFORE the first attempt record is written', async () => {
    const { calls } = await run();

    const firstTask = calls.findIndex(c => c.startsWith('appendTask:'));
    const firstAttempt = calls.findIndex(c => c.startsWith('saveAttempt:'));

    expect(firstTask).toBeGreaterThanOrEqual(0);
    expect(firstAttempt).toBeGreaterThanOrEqual(0);
    // A sink that waits for the attempt record before accepting tasks loses them.
    expect(firstTask).toBeLessThan(firstAttempt);
});

test('tasks arrive in ascending index order, and never before their producer', async () => {
    const { tasks } = await run();

    const indices = tasks.map(t => t.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));

    // Every task's input slot is either the entry or an index already seen — this
    // is what lets a sink resolve a parent without buffering.
    const seen = new Set<number>();
    for (const t of tasks) {
        expect(t.inputIndex < ENTRY.length || seen.has(t.inputIndex)).toBe(true);
        seen.add(t.index);
    }
});

test('an attempt record always precedes its own stimulation-terminal state', async () => {
    const { calls } = await run();

    // Each flush writes the stimulation, then the attempt — a sink relying on the
    // stimulation record to exist first can do so.
    for (let i = 0; i < calls.length; i++) {
        if (calls[i].startsWith('saveAttempt:')) {
            expect(calls[i - 1]).toBe('saveStimulation');
        }
    }
});

test('the last attempt record is terminal, and it is the only terminal one', async () => {
    const { attempts } = await run();

    const terminal = attempts.filter(a => a.status !== 'running');
    expect(terminal).toHaveLength(1);
    expect(attempts[attempts.length - 1].status).not.toBe('running');
    expect(attempts[attempts.length - 1].completedAt).not.toBeNull();
});

test('the persistor reads the stimulation back on every flush', async () => {
    // `flush` calls `getStimulation` to carry a Clone's original entry across
    // attempts — so a write-only sink MUST answer it, even with undefined.
    const { calls } = await run();

    expect(calls).toContain('getStimulation');
});

test('an aborted run settles as `aborted`, not as `failed`', async () => {
    // Needs a genuinely async hop: a synchronous flow runs to completion inside
    // `stimulate()` and there is no mid-run moment left to abort.
    const input = cnsCollateral<{ id: number }>();
    const mid = cnsCollateral<{ id: number }>();
    const out = cnsCollateral<{ result: string }>();

    const first = cnsNeuron({ mid }).dendrite({
        collateral: input,
        response: async (p, axon) => {
            await new Promise(r => setTimeout(r, 30));
            return axon.mid.createSignal({ id: p!.id });
        },
    });
    const second = cnsNeuron({ out }).dendrite({
        collateral: mid,
        response: (p, axon) => axon.out.createSignal({ result: `ok-${p!.id}` }),
    });

    const cns = new CNS([first, second]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('first', first);
    registry.register('second', second);
    registry.registerCollateral('input', input);

    const sink = recordingWriter();
    const controller = new AbortController();

    const persistor = new CNSStimulationPersistor({
        repository: sink.writer,
        registry,
        stimulationId: 'run-abort',
        stimulationAttemptId: 'run-abort#1',
        attemptNumber: 1,
        entry: ENTRY,
        volume: 'full',
    });

    const stimulation = cns.stimulate(input.createSignal({ id: 1 }), {
        onResponse: persistor.onResponse,
        abortSignal: controller.signal,
    });
    // Abort while the first hop is still awaiting its promise.
    await new Promise(r => setTimeout(r, 5));
    controller.abort();
    await stimulation.waitUntilComplete().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    persistor.dispose();

    const last = sink.attempts[sink.attempts.length - 1];
    // Before the engine announced the abort, this record never arrived at all and
    // the run stayed `running` for good.
    expect(last).toBeDefined();
    expect(last.status).toBe('aborted');
});

test('a task carries the duration the engine measured', async () => {
    const { tasks } = await run();

    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) {
        expect(typeof t.startedAt).toBe('number');
        expect(typeof t.duration).toBe('number');
        expect(t.duration).toBeGreaterThanOrEqual(0);
    }
});

test('replayOf is recorded when the attempt was forked from another', async () => {
    const { cns, registry, input } = buildFlow();
    const sink = recordingWriter();

    const persistor = new CNSStimulationPersistor({
        repository: sink.writer,
        registry,
        stimulationId: 'order-42-clone-1-a',
        stimulationAttemptId: 'order-42-clone-1-a#1',
        attemptNumber: 1,
        entry: ENTRY,
        volume: 'full',
        replayOf: 'order-42#1',
    });

    const stimulation = cns.stimulate(input.createSignal({ id: 1 }), {
        onResponse: persistor.onResponse,
    });
    await stimulation.waitUntilComplete().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    persistor.dispose();

    expect(sink.attempts[sink.attempts.length - 1].replayOf).toBe('order-42#1');
});
