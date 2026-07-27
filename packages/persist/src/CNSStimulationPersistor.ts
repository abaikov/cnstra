import type { ICNSStimulation, TCNSStimulationResponse } from '@cnstra/types';
import type {
    TCNSStimulationStatus,
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
    TCNSStimulationTaskPersisted,
} from '@cnstra/persist-dto';
import type { ICNSStimulationPersistor } from './interfaces/ICNSStimulationPersistor';
import type { ICNSProgressRecordingStrategy } from './interfaces/ICNSProgressRecordingStrategy';
import type { TCNSStimulationPersistorOptions } from './types/TCNSStimulationPersistorOptions';
import { CNSProgressSerializer } from './CNSProgressSerializer';
import { CNSDebouncedProgressRecordingStrategy } from './CNSDebouncedProgressRecordingStrategy';

/**
 * Write side of the durable-execution layer. Wire its `onResponse` into a run
 * (`cns.stimulate(sig, { onResponse })` / `cns.activate(tasks, { onResponse })`).
 *
 * Always keeps the run's `progress` (frontier + context) current for resume — on a
 * cadence decided by a {@link ICNSProgressRecordingStrategy}, plus an immediate flush
 * on the terminal response — and upserts the attempt marker. At `'full'` volume it
 * additionally appends every settled task as a history row: the firing neuron comes
 * from `response.neuron` (reliable even for sink/failed tasks), and each task's input
 * is deduped to an `inputIndex` — a slot in `[ entry(0..k-1), tasks(k..) ]` — instead
 * of duplicating the producer's payload.
 *
 * It never deletes the run — record lifecycle is the integration's concern.
 *
 * Sibling of {@link CNSProgressRecorder}, NOT a replacement: both orchestrate the
 * shared {@link CNSProgressSerializer} + {@link ICNSProgressRecordingStrategy}, but
 * target different STORE SHAPES. This persistor writes the relational run/attempt/task
 * model to an {@link ICNSStimulationWriter}; the recorder writes just the frontier blob
 * to a minimal KV {@link ICNSProgressRepository} — the only shape a store like BullMQ's
 * native job-progress can hold. Pick the recorder for a cheap resume checkpoint, this
 * for full history/observability.
 */
export class CNSStimulationPersistor implements ICNSStimulationPersistor {
    private readonly strategy: ICNSProgressRecordingStrategy;
    private readonly serializer: CNSProgressSerializer;
    private readonly startedAt = Date.now();
    private hopCount = 0;

    // full-volume task bookkeeping
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

    readonly onResponse = (response: TCNSStimulationResponse): void => {
        this.hopCount += 1;
        if (this.options.volume === 'full') this.recordTask(response);
        const done = response.queueLength === 0;
        if (done) {
            void this.flush(response.stimulation, true);
            return;
        }
        this.strategy.onResponse(response, () => {
            void this.flush(response.stimulation, false);
        });
    };

    private recordTask(response: TCNSStimulationResponse): void {
        // Only real neuron activations are tasks. The entry-signal injection is
        // emitted with no neuron (its output collateral already occupies an entry
        // slot) — skip it.
        if (!response.neuron) return;

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

        const index = this.nextTaskIndex++;
        // The input's producer: an entry slot or an earlier task's output slot.
        const inputIndex =
            this.producerByCollateral.get(dendriteCollateralName) ?? 0;
        if (outputCollateralName)
            this.producerByCollateral.set(outputCollateralName, index);

        const task: TCNSStimulationTaskPersisted = {
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
            startedAt: Date.now(),
            duration: null,
        };
        void this.options.repository.appendTask(task);
    }

    private async flush(
        stimulation: ICNSStimulation<any>,
        done: boolean
    ): Promise<void> {
        const { repository } = this.options;
        const options = this.options;
        const hasError = stimulation.getFailedTasks().length > 0;
        const status: TCNSStimulationStatus = done
            ? hasError
                ? 'failed'
                : 'completed'
            : 'running';

        // Preserve the stimulation's original `entry` (the Clone origin) across attempts.
        const existing = await repository.getStimulation(options.stimulationId);
        const entry = existing?.entry ?? options.entry[0];
        if (!entry) return;

        const stimulationRecord: TCNSStimulationPersisted = {
            stimulationId: options.stimulationId,
            entry,
            status,
            progress: this.serializer.serialize(stimulation),
            ...(options.scopeName !== undefined
                ? { scopeName: options.scopeName }
                : existing?.scopeName !== undefined
                ? { scopeName: existing.scopeName }
                : {}),
        };
        const attempt: TCNSStimulationAttemptPersisted = {
            stimulationAttemptId: options.stimulationAttemptId,
            stimulationId: options.stimulationId,
            attemptNumber: options.attemptNumber,
            status,
            startedAt: this.startedAt,
            completedAt: done ? Date.now() : null,
            hopCount: this.hopCount,
            hasError,
            replayOf: null,
            entry: options.entry,
        };
        await repository.saveStimulation(stimulationRecord);
        await repository.saveAttempt(attempt);
    }

    dispose(): void {
        this.strategy.dispose();
    }
}
