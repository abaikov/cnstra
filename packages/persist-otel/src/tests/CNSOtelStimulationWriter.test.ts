import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span, SpanContext, SpanOptions, Tracer } from '@opentelemetry/api';
import type {
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

import { CNSOtelStimulationWriter } from '.././CNSOtelStimulationWriter';

/** One span the fake tracer handed out, with everything the writer did to it. */
type TRecordedSpan = {
    name: string;
    options?: SpanOptions;
    parentSpanId?: string;
    attributes: Record<string, unknown>;
    status?: { code: SpanStatusCode; message?: string };
    endTime?: number;
    ended: boolean;
    exceptions: unknown[];
};

const fakeTracer = () => {
    const spans: TRecordedSpan[] = [];
    let nextId = 0;

    const tracer: Tracer = {
        startSpan(name, options, context) {
            const spanId = `span-${++nextId}`;
            const parent = context ? trace.getSpan(context) : undefined;

            const recorded: TRecordedSpan = {
                name,
                options,
                parentSpanId: parent?.spanContext().spanId,
                attributes: { ...(options?.attributes ?? {}) },
                ended: false,
                exceptions: [],
            };
            spans.push(recorded);

            const spanContext: SpanContext = {
                traceId: '0af7651916cd43dd8448eb211c80319c',
                spanId,
                traceFlags: 1,
            };

            const span = {
                spanContext: () => spanContext,
                updateName(next: string) {
                    recorded.name = next;
                    return span;
                },
                setAttribute(key: string, value: unknown) {
                    recorded.attributes[key] = value;
                    return span;
                },
                setStatus(status: { code: SpanStatusCode; message?: string }) {
                    recorded.status = status;
                    return span;
                },
                recordException(exception: unknown) {
                    recorded.exceptions.push(exception);
                    return span;
                },
                end(endTime?: number) {
                    recorded.endTime = endTime;
                    recorded.ended = true;
                },
            } as unknown as Span;

            return span;
        },
        startActiveSpan: (() => {
            throw new Error('startActiveSpan is not used by the writer');
        }) as Tracer['startActiveSpan'],
    };

    return { tracer, spans };
};

const attempt = (
    overrides: Partial<TCNSStimulationAttempt> = {}
): TCNSStimulationAttempt => ({
    stimulationAttemptId: 'attempt-1',
    stimulationId: 'run-1',
    attemptNumber: 1,
    status: 'running',
    startedAt: 1_000,
    completedAt: null,
    hopCount: 0,
    hasError: false,
    replayOf: null,
    entry: [{ collateralName: 'order.created', payload: { id: 7 } }],
    ...overrides,
});

const task = (
    overrides: Partial<TCNSStimulationTask> = {}
): TCNSStimulationTask => ({
    stimulationAttemptId: 'attempt-1',
    index: 1,
    neuronName: 'validate',
    dendriteCollateralName: 'order.created',
    inputIndex: 0,
    output: { collateralName: 'order.validated', payload: null },
    status: 'done',
    error: null,
    startedAt: 1_010,
    duration: null,
    ...overrides,
});

describe('CNSOtelStimulationWriter', () => {
    it('opens a root span for an attempt, stamped with the attempt start time', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());

        expect(spans).toHaveLength(1);
        expect(spans[0].name).toBe('order.created');
        expect(spans[0].options?.startTime).toBe(1_000);
        expect(spans[0].attributes).toMatchObject({
            'cnstra.stimulation_id': 'run-1',
            'cnstra.attempt_number': 1,
        });
    });

    it('opens the root on a task too, because tasks arrive before any attempt record', async () => {
        // `CNSStimulationPersistor` appends each settled task immediately and only
        // writes the attempt record when it flushes — so the first thing a writer
        // sees is normally a task, not the attempt.
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.appendTask(task());

        expect(spans).toHaveLength(2);
        expect(spans[1].name).toBe('validate');
        expect(spans[1].parentSpanId).toBe('span-1');
    });

    it('fills the root attributes in when the attempt record finally arrives', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.appendTask(task());
        await writer.saveAttempt(attempt());

        const root = spans[0];
        expect(root.name).toBe('order.created');
        expect(root.attributes).toMatchObject({
            'cnstra.stimulation_id': 'run-1',
            'cnstra.attempt_id': 'attempt-1',
            'cnstra.attempt_number': 1,
        });
        // Opened on the task, so it carries the first hop's timestamp.
        expect(root.options?.startTime).toBe(1_010);
    });

    it('parents a task on the attempt root when its input came from the entry', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.appendTask(task({ index: 1, inputIndex: 0 }));

        const [root, hop] = spans;
        expect(root.name).toBe('order.created');
        expect(hop.name).toBe('validate');
        expect(hop.parentSpanId).toBe('span-1');
        expect(hop.attributes).toMatchObject({
            'cnstra.dendrite_collateral': 'order.created',
            'cnstra.task_index': 1,
        });
    });

    it('parents a task on the task that produced its input', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.appendTask(task({ index: 1, inputIndex: 0 }));
        await writer.appendTask(
            task({
                index: 2,
                inputIndex: 1,
                neuronName: 'charge',
                dendriteCollateralName: 'order.validated',
            })
        );

        const [, first, second] = spans;
        expect(second.name).toBe('charge');
        expect(second.parentSpanId).toBe('span-2');
        expect(first.parentSpanId).toBe('span-1');
    });

    it('marks a failed task with an error status and records the message', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.appendTask(
            task({ status: 'failed', error: 'Error: card declined' })
        );

        const hop = spans[1];
        expect(hop.status?.code).toBe(SpanStatusCode.ERROR);
        expect(hop.status?.message).toBe('Error: card declined');
        expect(hop.exceptions).toEqual(['Error: card declined']);
    });

    it('leaves the root open while the attempt is still running', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        // A progress flush mid-run: the attempt record says 'running'.
        await writer.saveAttempt(attempt());
        await writer.saveAttempt(attempt({ hopCount: 1 }));

        expect(spans).toHaveLength(1);
        expect(spans[0].ended).toBe(false);
        expect(writer.openAttemptCount).toBe(1);
    });

    it('closes the root span when the attempt settles, using its completion time', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.saveAttempt(
            attempt({ status: 'completed', completedAt: 1_500, hopCount: 3 })
        );

        expect(spans).toHaveLength(1);
        expect(spans[0].endTime).toBe(1_500);
        expect(spans[0].attributes['cnstra.hop_count']).toBe(3);
        expect(spans[0].status?.code).toBe(SpanStatusCode.OK);
    });

    it('marks a failed attempt as an error', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.saveAttempt(
            attempt({ status: 'failed', completedAt: 1_500, hasError: true })
        );

        expect(spans[0].status?.code).toBe(SpanStatusCode.ERROR);
    });

    it('forgets a settled attempt so long-lived processes do not leak spans', async () => {
        const { tracer } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.saveAttempt(
            attempt({ status: 'completed', completedAt: 1_500 })
        );

        expect(writer.openAttemptCount).toBe(0);
    });

    it('records the attempt it was forked from as an attribute', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(
            attempt({
                stimulationAttemptId: 'attempt-2',
                attemptNumber: 2,
                replayOf: 'attempt-1',
            })
        );

        expect(spans[0].attributes['cnstra.replay_of']).toBe('attempt-1');
    });

    it('gives a task span a real length once the model carries a duration', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.appendTask(task({ startedAt: 1_010, duration: 42 }));

        expect(spans[1].options?.startTime).toBe(1_010);
        expect(spans[1].endTime).toBe(1_052);
    });

    it('falls back to a point-in-time span while duration is still null', async () => {
        // `CNSStimulationPersistor` writes `duration: null` today, so the only
        // honest span is a zero-length one at the recorded timestamp.
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveAttempt(attempt());
        await writer.appendTask(task({ startedAt: 1_010, duration: null }));

        expect(spans[1].options?.startTime).toBe(1_010);
        expect(spans[1].endTime).toBe(1_010);
    });

    it('takes a stimulation record without opening anything of its own', async () => {
        const { tracer, spans } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await writer.saveStimulation({
            stimulationId: 'run-1',
            entry: { collateralName: 'order.created', payload: null },
            status: 'running',
            progress: { tasks: [] },
        });

        expect(spans).toHaveLength(0);
    });

    it('is write-only: getStimulation resolves to undefined', async () => {
        const { tracer } = fakeTracer();
        const writer = new CNSOtelStimulationWriter({ tracer });

        await expect(writer.getStimulation()).resolves.toBeUndefined();
    });
});
