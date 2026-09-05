import type { TCNSPlannedTaskJSON } from './TCNSPlannedTaskJSON';

/**
 * The resumable resume state of a run: its current outstanding frontier, keyed by
 * name. One live record per run, updated over time; feed it back through
 * `CNSProgressSerializer.hydrate()` + `cns.activate()` to resume the not-yet-done
 * work. Each task carries its own input signal (with payload), so re-driving the
 * frontier needs no extra state. Storage concerns (timestamps, TTL, versioning,
 * job lifecycle) belong to the repository/envelope, not to this pure DTO.
 */
export type TCNSProgress = {
    /** The outstanding frontier (from `getOutstandingTasks()`), by name. */
    tasks: TCNSPlannedTaskJSON[];
};
