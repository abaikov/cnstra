import {
    ROOT_CONTEXT,
    SpanStatusCode,
    trace,
    type Span,
    type Tracer,
} from '@opentelemetry/api';
import type { ICNSStimulationWriter } from '@cnstra/persist';
import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

export type TCNSOtelStimulationWriterOptions = {
    /** The application's tracer. This package never creates a provider of its own. */
    tracer: Tracer;
    /**
     * Prefix for the attributes this writer sets. Defaults to `cnstra`, giving
     * `cnstra.stimulation_id`, `cnstra.task_index`, and so on.
     */
    attributePrefix?: string;
};

/** What we keep for an attempt while it is open: its root span and its task spans. */
type TOpenAttempt = {
    root: Span;
    /** Task index → that task's span, so a later task can hang off its producer. */
    spanByTaskIndex: Map<number, Span>;
    /** Set once the attempt record has arrived and filled the root's attributes. */
    described: boolean;
};

/**
 * Emits the resumable model as spans, from the persisted records: an attempt is a
 * root, a task is a child parented through `inputIndex`. Prefer
 * {@link attachCNSOtelTracing}, which builds the same tree from the live engine.
 *
 * The root opens on whichever record of an attempt arrives first — tasks usually
 * beat the attempt record, since the persistor appends them as they settle — and
 * its attempt attributes are filled in when that record does arrive.
 */
export class CNSOtelStimulationWriter implements ICNSStimulationWriter {
    private readonly tracer: Tracer;
    private readonly prefix: string;
    private readonly open = new Map<string, TOpenAttempt>();

    constructor(options: TCNSOtelStimulationWriterOptions) {
        this.tracer = options.tracer;
        this.prefix = options.attributePrefix ?? 'cnstra';
    }

    /** Attempts currently held in memory. Exposed so leaks are observable in tests. */
    get openAttemptCount(): number {
        return this.open.size;
    }

    /**
     * The stimulation record is resume state — status and the outstanding frontier.
     * It carries no timing of its own and its identity already rides on every
     * attempt span, so there is nothing here worth a span of its own.
     */
    async saveStimulation(_stimulation: TCNSStimulationState): Promise<void> {}

    async saveAttempt(attempt: TCNSStimulationAttempt): Promise<void> {
        const entry = attempt.entry[0]?.collateralName ?? 'stimulation';
        const open = this.openAttempt(
            attempt.stimulationAttemptId,
            entry,
            attempt.startedAt
        );

        if (!open.described) {
            open.root.updateName(entry);
            open.root.setAttribute(
                `${this.prefix}.stimulation_id`,
                attempt.stimulationId
            );
            open.root.setAttribute(
                `${this.prefix}.attempt_id`,
                attempt.stimulationAttemptId
            );
            open.root.setAttribute(
                `${this.prefix}.attempt_number`,
                attempt.attemptNumber
            );
            open.root.setAttribute(`${this.prefix}.entry_collateral`, entry);
            if (attempt.replayOf)
                open.root.setAttribute(
                    `${this.prefix}.replay_of`,
                    attempt.replayOf
                );
            open.described = true;
        }

        // Still running: the record is a progress flush, not the end of the run.
        if (attempt.status === 'running') return;

        open.root.setAttribute(`${this.prefix}.hop_count`, attempt.hopCount);
        open.root.setStatus(
            attempt.status === 'failed' || attempt.hasError
                ? { code: SpanStatusCode.ERROR }
                : { code: SpanStatusCode.OK }
        );
        open.root.end(attempt.completedAt ?? undefined);
        this.open.delete(attempt.stimulationAttemptId);
    }

    async appendTask(task: TCNSStimulationTask): Promise<void> {
        const open = this.openAttempt(
            task.stimulationAttemptId,
            'stimulation',
            task.startedAt
        );
        const parent = open.spanByTaskIndex.get(task.inputIndex) ?? open.root;

        const span = this.tracer.startSpan(
            task.neuronName,
            {
                startTime: task.startedAt,
                attributes: {
                    [`${this.prefix}.task_index`]: task.index,
                    [`${this.prefix}.dendrite_collateral`]:
                        task.dendriteCollateralName,
                    ...(task.output
                        ? {
                              [`${this.prefix}.output_collateral`]:
                                  task.output.collateralName,
                          }
                        : {}),
                },
            },
            trace.setSpan(ROOT_CONTEXT, parent)
        );

        if (task.status === 'failed') {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: task.error ?? undefined,
            });
            if (task.error) span.recordException(task.error);
        }

        // The engine measures each activation and reports it on the response,
        // so this is normally a real length. It stays `number | null` because a
        // record written by an older engine has no measurement — and a point in
        // time is the only honest span for one of those.
        span.end(task.startedAt + (task.duration ?? 0));

        open.spanByTaskIndex.set(task.index, span);
    }

    /** Write-only by construction — there is no read store behind a tracer. */
    async getStimulation(): Promise<TCNSStimulationState | undefined> {
        return undefined;
    }

    /** The attempt's root span, opened on first sight with the timestamp at hand. */
    private openAttempt(
        attemptId: string,
        name: string,
        startTime: number
    ): TOpenAttempt {
        const existing = this.open.get(attemptId);
        if (existing) return existing;

        const opened: TOpenAttempt = {
            root: this.tracer.startSpan(name, { startTime }),
            spanByTaskIndex: new Map(),
            described: false,
        };
        this.open.set(attemptId, opened);
        return opened;
    }
}
