import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

import {
    capCNSPayload,
    redactCNSPayload,
    retryCNSWrites,
    withCNSWriteChain,
} from '.././writerChain';
import type { TCNSStimulationWriteMiddleware } from '.././writerChain';
import type { ICNSStimulationWriter } from '.././interfaces/ICNSStimulationRepository';

const state: TCNSStimulationState = {
    stimulationId: 'run-1',
    entry: {
        collateralName: 'order.created',
        payload: { id: 7, card: '4111111111111111' },
    },
    status: 'running',
    progress: { tasks: [] },
};

const attempt: TCNSStimulationAttempt = {
    stimulationAttemptId: 'run-1#1',
    stimulationId: 'run-1',
    attemptNumber: 1,
    status: 'running',
    startedAt: 1_000,
    completedAt: null,
    hopCount: 0,
    hasError: false,
    replayOf: null,
    entry: [{ collateralName: 'order.created', payload: { card: '4111' } }],
};

const task: TCNSStimulationTask = {
    stimulationAttemptId: 'run-1#1',
    index: 1,
    neuronName: 'charge',
    dendriteCollateralName: 'order.created',
    inputIndex: 0,
    output: {
        collateralName: 'order.charged',
        payload: { ok: true, card: '4111111111111111', nested: { token: 'abc' } },
    },
    status: 'done',
    error: null,
    startedAt: 1_010,
    duration: 5,
};

const recordingStore = (fail = 0) => {
    const written: Array<{ kind: string; record: any }> = [];
    let failures = fail;

    const store: ICNSStimulationWriter = {
        async saveStimulation(record) {
            if (failures-- > 0) throw new Error('store is down');
            written.push({ kind: 'stimulation', record });
        },
        async saveAttempt(record) {
            if (failures-- > 0) throw new Error('store is down');
            written.push({ kind: 'attempt', record });
        },
        async appendTask(record) {
            if (failures-- > 0) throw new Error('store is down');
            written.push({ kind: 'task', record });
        },
        async getStimulation() {
            return state;
        },
    };

    return { store, written };
};

describe('withCNSWriteChain', () => {
    it('passes every kind of write through to the store', async () => {
        const s = recordingStore();
        const writer = withCNSWriteChain([], s.store);

        await writer.saveStimulation(state);
        await writer.saveAttempt(attempt);
        await writer.appendTask(task);

        expect(s.written.map(w => w.kind)).toEqual([
            'stimulation',
            'attempt',
            'task',
        ]);
    });

    it('runs links in order, around the store', async () => {
        const log: string[] = [];
        const link = (name: string): TCNSStimulationWriteMiddleware =>
            async (_write, next) => {
                log.push(`${name}:enter`);
                await next();
                log.push(`${name}:exit`);
            };
        const s = recordingStore();

        await withCNSWriteChain([link('a'), link('b')], s.store).appendTask(task);

        expect(log).toEqual(['a:enter', 'b:enter', 'b:exit', 'a:exit']);
        expect(s.written).toHaveLength(1);
    });

    it('lets a link drop a write by not passing it on', async () => {
        const s = recordingStore();
        const drop: TCNSStimulationWriteMiddleware = async write => {
            if (write.kind === 'task') return;
        };

        const writer = withCNSWriteChain([drop], s.store);
        await writer.appendTask(task);
        await writer.saveAttempt(attempt);

        expect(s.written.map(w => w.kind)).toEqual([]);
    });

    it('leaves reads alone — resume must see what the store holds', async () => {
        const s = recordingStore();
        const rewrite: TCNSStimulationWriteMiddleware = (write, next) => {
            write.record = { ...write.record, stimulationId: 'rewritten' } as never;
            return next();
        };

        await expect(
            withCNSWriteChain([rewrite], s.store).getStimulation('run-1')
        ).resolves.toBe(state);
    });

    it('allows next() more than once — that is what a retry link does', async () => {
        // Unlike the DevTools action chain, where a second next() would re-run a
        // retry. Here the writes are idempotent, so replaying the tail is the
        // mechanism, not a bug.
        const s = recordingStore();
        const twice: TCNSStimulationWriteMiddleware = async (_w, next) => {
            await next();
            await next();
        };

        await withCNSWriteChain([twice], s.store).appendTask(task);

        expect(s.written).toHaveLength(2);
    });
});

describe('retryCNSWrites', () => {
    it('retries a failing write and succeeds', async () => {
        const s = recordingStore(2);
        const seen: number[] = [];

        await withCNSWriteChain(
            [
                retryCNSWrites({
                    attempts: 3,
                    delayMs: 1,
                    onError: (_e, attempt) => seen.push(attempt),
                }),
            ],
            s.store
        ).appendTask(task);

        expect(seen).toEqual([1, 2]);
        expect(s.written).toHaveLength(1);
    });

    it('gives up after the last try and rethrows, rather than losing the write silently', async () => {
        const s = recordingStore(10);

        await expect(
            withCNSWriteChain(
                [retryCNSWrites({ attempts: 2, delayMs: 1 })],
                s.store
            ).appendTask(task)
        ).rejects.toThrow('store is down');
        expect(s.written).toEqual([]);
    });

    it('does not retry a write that succeeded', async () => {
        const s = recordingStore();
        const seen: number[] = [];

        await withCNSWriteChain(
            [retryCNSWrites({ delayMs: 1, onError: (_e, a) => seen.push(a) })],
            s.store
        ).appendTask(task);

        expect(seen).toEqual([]);
        expect(s.written).toHaveLength(1);
    });
});

describe('redactCNSPayload', () => {
    it('replaces a named key in a task output, at any depth', async () => {
        const s = recordingStore();

        await withCNSWriteChain([redactCNSPayload(['card', 'token'])], s.store).appendTask(
            task
        );

        expect(s.written[0].record.output.payload).toEqual({
            ok: true,
            card: '[redacted]',
            nested: { token: '[redacted]' },
        });
    });

    it('redacts the entry of a stimulation and of an attempt too', async () => {
        const s = recordingStore();
        const writer = withCNSWriteChain([redactCNSPayload(['card'])], s.store);

        await writer.saveStimulation(state);
        await writer.saveAttempt(attempt);

        expect(s.written[0].record.entry.payload).toMatchObject({
            card: '[redacted]',
        });
        expect(s.written[1].record.entry[0].payload).toEqual({
            card: '[redacted]',
        });
    });

    it('never touches the record the caller still holds', async () => {
        // The payload can be the live signal's own object; mutating it would
        // corrupt the run itself.
        const s = recordingStore();
        const original = JSON.parse(JSON.stringify(task));

        await withCNSWriteChain([redactCNSPayload(['card'])], s.store).appendTask(task);

        expect(task).toEqual(original);
    });

    it('leaves everything not named alone', async () => {
        const s = recordingStore();

        await withCNSWriteChain([redactCNSPayload(['nothing-here'])], s.store).appendTask(
            task
        );

        expect(s.written[0].record.output.payload).toEqual(task.output!.payload);
    });
});

describe('capCNSPayload', () => {
    it('drops a payload over the limit but keeps the record', async () => {
        const s = recordingStore();
        const fat: TCNSStimulationTask = {
            ...task,
            output: {
                collateralName: 'order.charged',
                payload: { blob: 'x'.repeat(2_000) },
            },
        };

        await withCNSWriteChain([capCNSPayload(500)], s.store).appendTask(fat);

        expect(s.written[0].record.output.payload).toBe('[dropped: too large]');
        expect(s.written[0].record.neuronName).toBe('charge');
        expect(s.written[0].record.index).toBe(1);
    });

    it('leaves a payload under the limit untouched', async () => {
        const s = recordingStore();

        await withCNSWriteChain([capCNSPayload(10_000)], s.store).appendTask(task);

        expect(s.written[0].record.output.payload).toEqual(task.output!.payload);
    });

    it('drops a payload that cannot be serialized at all', async () => {
        // A circular payload makes the store's own JSON.stringify throw; better
        // to lose the value than the write.
        const s = recordingStore();
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        await withCNSWriteChain([capCNSPayload(10_000)], s.store).appendTask({
            ...task,
            output: { collateralName: 'c', payload: circular },
        });

        expect(s.written[0].record.output.payload).toBe('[dropped: too large]');
    });

    it('caps an attempt entry too — the same payload arrives by that door on resume', async () => {
        const s = recordingStore();
        const fat: TCNSStimulationAttempt = {
            ...attempt,
            entry: [
                { collateralName: 'a', payload: { blob: 'x'.repeat(2_000) } },
                { collateralName: 'b', payload: { small: 1 } },
            ],
        };

        await withCNSWriteChain([capCNSPayload(500)], s.store).saveAttempt(fat);

        expect(s.written[0].record.entry[0].payload).toBe('[dropped: too large]');
        // Only the oversized one is dropped.
        expect(s.written[0].record.entry[1].payload).toEqual({ small: 1 });
    });

    it('caps a stimulation entry as well', async () => {
        const s = recordingStore();

        await withCNSWriteChain([capCNSPayload(10)], s.store).saveStimulation(state);

        expect(s.written[0].record.entry.payload).toBe('[dropped: too large]');
    });
});

describe('the three composed', () => {
    it('redacts, caps and retries in the order given', async () => {
        const s = recordingStore(1);

        await withCNSWriteChain(
            [
                retryCNSWrites({ attempts: 2, delayMs: 1 }),
                redactCNSPayload(['card']),
                capCNSPayload(10_000),
            ],
            s.store
        ).appendTask(task);

        expect(s.written).toHaveLength(1);
        expect(s.written[0].record.output.payload).toMatchObject({
            card: '[redacted]',
        });
    });
});
