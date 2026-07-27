import type { TCNSSignalRef } from './TCNSSignalRef';
import type { TCNSStimulationTaskStatus } from './TCNSStimulationTaskStatus';

/**
 * One settled task in an attempt's history — a neuron activation with its input
 * and produced output. Identity within an attempt is the ordinal `index` (the
 * "task number"); no uuid, and it never has to line up with the id-less frontier.
 *
 * Payloads are stored once: a task's `output` is the canonical home of its payload,
 * and downstream tasks reference it by `inputIndex` instead of duplicating it. The
 * input space is `[ entry(0..k-1), tasks(k..) ]` where `k = attempt.entry.length`:
 * - `inputIndex < k` ⇒ input is `attempt.entry[inputIndex]`;
 * - `inputIndex >= k` ⇒ input is `tasks[inputIndex].output`.
 * It is **always** a valid slot — never null.
 */
export type TCNSStimulationTaskPersisted = {
    stimulationAttemptId: string;
    /** Ordinal identity within the attempt (`>= k`). */
    index: number;
    /** Always present — a task is a neuron activation (resolve-or-throw). */
    neuronName: string;
    dendriteCollateralName: string;
    /** Slot of the input's producer: `< k` ⇒ entry, `>= k` ⇒ another task's output. */
    inputIndex: number;
    /** Payload lives here, once; downstream tasks point back via `inputIndex`. */
    output: TCNSSignalRef | null;
    status: TCNSStimulationTaskStatus;
    error: string | null;
    startedAt: number;
    duration: number | null;
};
