import type { ICNSStimulation, TCNSStimulationResponse } from '@cnstra/types';
import type {
    ECNSStimulationStatus,
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSSignalJSON,
} from '@cnstra/persist-dto';
import type { ICNSStimulationPersistor } from './interfaces/ICNSStimulationPersistor';
import type { ICNSProgressRecordingStrategy } from './interfaces/ICNSProgressRecordingStrategy';
import type { TCNSStimulationPersistorOptions } from './types/TCNSStimulationPersistorOptions';
import { CNSProgressSerializer } from './CNSProgressSerializer';
import { portable } from './portable';
import { CNSDebouncedProgressRecordingStrategy } from './CNSDebouncedProgressRecordingStrategy';

/**
 * Write side of the resumable layer: wire its `onResponse` into a run.
 *
 * Keeps the outstanding frontier current for resume — on the strategy's cadence,
 * plus an immediate flush on the terminal response — and upserts the attempt. At
 * `'full'` volume it also appends each settled task, its input deduped to an
 * `inputIndex` into `[ entry(0..k-1), tasks(k..) ]` rather than copied.
 *
 * It never deletes a run; that lifecycle belongs to the integration.
 *
 * {@link CNSProgressRecorder} is the sibling for a different store shape: the
 * frontier blob alone, into a KV repository. Use it for a cheap checkpoint, this
 * for history.
 */
export class CNSStimulationPersistor implements ICNSStimulationPersistor {
    private readonly strategy: ICNSProgressRecordingStrategy;
    private readonly serializer: CNSProgressSerializer;
    private readonly startedAt = Date.now();
    private hopCount = 0;

    /**
     * Flushes run one at a time, in the order they were requested.
     *
     * Each flush reads then writes (`getStimulation` → `saveStimulation` →
     * `saveAttempt`) and computes its status BEFORE the first await, so two
     * overlapping flushes can interleave and let the older one — carrying
     * `status: 'running'`, `completedAt: null` — land last, over the terminal
     * record. Against a real store that is not a race you can win by ordering
     * the calls: the store decides. So the calls are serialised here.
     *
     * Invariant: this promise NEVER rejects. A failed write must not wedge every
     * later flush (nor surface as an unhandled rejection through the chain) —
     * the rejection is delivered to that flush's own caller instead.
     */
    private writeChain: Promise<void> = Promise.resolve();
    /** Set once the terminal flush is queued — nothing older may follow it. */
    private terminalFlushQueued = false;
    /**
     * The run's stored identity — the original entry signal and the scope —
     * resolved on the first checkpoint and constant thereafter.
     */
    private identity?: { entry: TCNSSignalJSON; scopeName?: string };

    // full-volume task bookkeeping
    /**
     * Which task produced a given signal, by the signal OBJECT.
     *
     * This is exact. The engine hands the very same signal object to every
     * subscriber of a collateral, so the object identifies its producer with no
     * ambiguity — including when one neuron is entered several times in a run and
     * emits the same collateral each time. A map keyed by collateral NAME cannot
     * tell those apart: the last writer wins, and every consumer of the earlier
     * signals is recorded as having consumed the last one.
     */
    private readonly producerBySignal = new WeakMap<object, number>();
    /**
     * The same thing keyed by name, kept for the two cases the object map cannot
     * serve: the entry slots, which exist as JSON before any signal object does,
     * and a resumed attempt, whose producers ran in another process entirely.
     */
    private readonly producerByCollateral = new Map<string, number>();
    private nextTaskIndex: number;

    constructor(private readonly options: TCNSStimulationPersistorOptions) {
        this.strategy =
            options.strategy ?? new CNSDebouncedProgressRecordingStrategy();
        this.serializer = new CNSProgressSerializer(options.registry);
        // Entry inputs occupy the leading slots 0..k-1; real tasks follow at k.
        const k = options.entry.length;
        options.entry.forEach((e, i) =>
            this.producerByCollateral.set(e.collateralName, i)
        );
        this.nextTaskIndex = k;
    }

    readonly onResponse = (
        response: TCNSStimulationResponse
    ): void | Promise<void> => {
        this.hopCount += 1;
        const taskWrite =
            this.options.volume === 'full' ? this.recordTask(response) : undefined;
        const done = response.queueLength === 0;

        // Barrier: hand the engine a promise. It parks this hop's subscribers
        // until the promise settles, so no activation can run ahead of a
        // checkpoint that has not landed — the "exactly-resumable" guarantee.
        //
        // It flushes on EVERY response, deliberately: the cadence strategy exists
        // to coalesce writes, and a write that may never happen for this response
        // cannot be a barrier for it. That cost is what the guarantee is made of.
        //
        // A failed write rejects, and the engine fails the run. Also deliberate:
        // if the checkpoint is not there, continuing is exactly what you asked
        // not to happen.
        if (this.options.barrier) {
            return Promise.all([
                taskWrite,
                this.flush(response.stimulation, done),
            ]).then(() => undefined);
        }

        if (done) {
            // Cancel the cadence timer BEFORE the terminal flush. A timer armed
            // by an earlier response still holds that response's closure: left
            // alive it fires afterwards and writes `status: 'running'`,
            // `completedAt: null` over the terminal record — a finished run
            // marked running forever, with a live Retry button. The caller
            // cannot prevent it (`dispose()` in a `finally` runs too late, and
            // nothing in the API requires disposing at all), so the terminal
            // path cancels it itself. `dispose()` is the strategy's documented
            // "cancel any pending timers" and is idempotent.
            this.strategy.dispose();
            this.fireAndForget(this.flush(response.stimulation, true));
            return;
        }
        this.strategy.onResponse(response, () => {
            this.fireAndForget(this.flush(response.stimulation, false));
        });
    };

    private recordTask(response: TCNSStimulationResponse): Promise<void> | undefined {
        // Only real neuron activations are tasks. The entry-signal injection is
        // emitted with no neuron (its output collateral already occupies an entry
        // slot) — skip it.
        if (!response.neuron) return undefined;

        const { registry } = this.options;
        const outputCol = response.outputSignal?.collateral;
        const inputCol = response.inputSignal?.collateral;

        const neuronName =
            registry.getNeuronName(response.neuron as never) ??
            '(unregistered)';
        const dendriteCollateralName = inputCol
            ? registry.getCollateralName(inputCol as never) ?? '(entry)'
            : '(entry)';
        const outputCollateralName = outputCol
            ? registry.getCollateralName(outputCol as never) ?? null
            : null;

        // Only the portable part: a live handle someone attached for this process
        // cannot mean anything to whoever reads the history later.
        const activationContext = portable(response.activationContext) as
            | Record<string, unknown>
            | undefined;

        const index = this.nextTaskIndex++;
        // The input's producer: an entry slot or an earlier task's output slot.
        // By object first — that answer is exact — and by name only when this
        // signal was not produced in this attempt (an entry, or a frontier task
        // resumed from a record written elsewhere).
        const inputSignal = response.inputSignal as object | undefined;
        const inputIndex =
            (inputSignal ? this.producerBySignal.get(inputSignal) : undefined) ??
            this.producerByCollateral.get(dendriteCollateralName) ??
            0;

        const outputSignal = response.outputSignal as object | undefined;
        if (outputSignal) this.producerBySignal.set(outputSignal, index);
        if (outputCollateralName)
            this.producerByCollateral.set(outputCollateralName, index);

        const task: TCNSStimulationTask = {
            stimulationAttemptId: this.options.stimulationAttemptId,
            index,
            neuronName,
            dendriteCollateralName,
            inputIndex,
            output:
                outputCol && outputCollateralName
                    ? {
                          collateralName: outputCollateralName,
                          payload: response.outputSignal?.payload,
                      }
                    : null,
            status: response.error ? 'failed' : 'done',
            error: response.error ? String(response.error) : null,
            // The engine measures the response; `startedAt` here is when the activation
            // BEGAN, not when it settled. Older engines report neither — fall back
            // to the settle moment and a null length rather than inventing one.
            startedAt: response.startedAt ?? Date.now(),
            duration: response.duration ?? null,
            ...(activationContext ? { activationContext } : {}),
        };
        // Returned, not voided: under a barrier the caller awaits it.
        const write = this.options.repository.appendTask(task);
        if (!this.options.barrier) this.fireAndForget(write);
        return write;
    }

    /**
     * Without a barrier a write is not awaited by anyone — and an unobserved
     * rejection terminates the host process under Node's default. A store hiccup
     * must not take the application down, so it is reported and dropped here.
     *
     * Dropped, not retried: doing better belongs in the writer, where a failed
     * write can be retried or dead-lettered without the engine waiting on it.
     * Use `barrier: true` when a lost write must fail the run instead.
     */
    private fireAndForget(write: Promise<void> | undefined): void {
        void write?.catch(error => {
            // eslint-disable-next-line no-console
            console.error('[@cnstra/persist] a stimulation write failed', error);
        });
    }

    /**
     * Queue a checkpoint write behind the ones already in flight.
     *
     * Returns the promise for THIS write (not the chain's), so a barrier caller
     * still awaits exactly its own checkpoint and still sees its own failure.
     */
    private flush(
        stimulation: ICNSStimulation<any>,
        done: boolean
    ): Promise<void> {
        // Belt and braces around the timer cancellation above: whatever a custom
        // strategy does with `dispose()`, a non-terminal flush arriving after the
        // terminal one carries an older status and may not touch the record.
        if (this.terminalFlushQueued && !done) return Promise.resolve();
        if (done) this.terminalFlushQueued = true;

        const write = this.writeChain.then(() =>
            this.writeCheckpoint(stimulation, done)
        );
        this.writeChain = write.then(
            () => undefined,
            () => undefined
        );
        return write;
    }

    private async writeCheckpoint(
        stimulation: ICNSStimulation<any>,
        done: boolean
    ): Promise<void> {
        const { repository } = this.options;
        const options = this.options;
        const failed = stimulation.getFailedTasks();
        const hasError = failed.length > 0;
        // A run killed by a deploy or a shutdown drain is not a business failure,
        // and an operator retries the two differently — so it gets its own status
        // rather than hiding inside `failed`.
        const wasAborted = failed.some(f => f.aborted);
        const status: ECNSStimulationStatus = done
            ? wasAborted
                ? 'aborted'
                : hasError
                ? 'failed'
                : 'completed'
            : 'running';

        // Preserve the stimulation's original `entry` (the Clone origin) across
        // attempts. Read once: both halves are fixed for the life of the run, and
        // checkpoints are serialised, so re-reading them per checkpoint was a
        // store round trip that could only ever answer the same thing.
        let identity = this.identity;
        if (!identity) {
            const existing = await repository.getStimulation(
                options.stimulationId
            );
            const entry = existing?.entry ?? options.entry[0];
            if (!entry) return;
            identity = this.identity = {
                entry,
                ...(options.scopeName !== undefined
                    ? { scopeName: options.scopeName }
                    : existing?.scopeName !== undefined
                    ? { scopeName: existing.scopeName }
                    : {}),
            };
        }

        const stimulationRecord: TCNSStimulationState = {
            stimulationId: options.stimulationId,
            entry: identity.entry,
            status,
            progress: this.serializer.serialize(stimulation),
            ...(identity.scopeName !== undefined
                ? { scopeName: identity.scopeName }
                : {}),
        };
        const attempt: TCNSStimulationAttempt = {
            stimulationAttemptId: options.stimulationAttemptId,
            stimulationId: options.stimulationId,
            attemptNumber: options.attemptNumber,
            status,
            startedAt: this.startedAt,
            completedAt: done ? Date.now() : null,
            hopCount: this.hopCount,
            hasError,
            replayOf: options.replayOf ?? null,
            entry: options.entry,
        };
        await repository.saveStimulation(stimulationRecord);
        await repository.saveAttempt(attempt);
    }

    /**
     * Cancel the cadence timer and hand back the outstanding writes.
     *
     * Returning them matters now that flushes are serialised: the terminal write
     * is queued behind whatever preceded it, so a caller that disposes and
     * immediately starts the NEXT attempt of the same run can otherwise have the
     * older attempt's record land last. Awaiting this is how you order two
     * attempts against one store. Ignoring it keeps the previous behaviour.
     */
    dispose(): Promise<void> {
        this.strategy.dispose();
        return this.writeChain;
    }
}
