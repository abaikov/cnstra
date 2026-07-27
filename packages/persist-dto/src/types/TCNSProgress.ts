import type { TCNSSerializedTask } from './TCNSSerializedTask';

/**
 * The durable resume state of a run: its current outstanding frontier plus the
 * per-neuron context, all keyed by name. One live record per run, updated over time;
 * feed it back through `CNSProgressSerializer.hydrate()` + `cns.activate()` to resume
 * the not-yet-done work. Storage concerns (timestamps, TTL, versioning, job
 * lifecycle) belong to the repository/envelope, not to this pure DTO.
 */
export type TCNSProgress = {
    /** The outstanding frontier (from `getOutstandingTasks()`), by name. */
    tasks: TCNSSerializedTask[];
    /** Per-neuron context (metadata), keyed by neuron name. */
    context: Record<string, unknown>;
};
