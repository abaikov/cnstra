import type { TCNSSignalJSON } from './TCNSSignalJSON';
import type { ECNSStimulationStatus } from './ECNSStimulationStatus';
import type { TCNSProgress } from './TCNSProgress';

/**
 * The persisted **state** of a stimulation — NOT the runtime stimulation itself. A
 * `Stimulation` (`ICNSStimulation` / `CNSStimulation`) is the in-code abstraction of a
 * live run; this is what survives in a store: its stable `stimulationId` (= the resume
 * key threaded across a process boundary), `status`, and `progress` (the live resume
 * state, mutated by whichever attempt is currently active) plus `entry` (the originating
 * signal, kept so a fresh **Clone** can be launched from scratch). The durable-execution
 * unit a human sees and can retry; its attempts/tasks are separate history records.
 *
 * Storage bookkeeping (created/updated timestamps, TTL, job lifecycle) belongs to the
 * repository envelope, not here.
 */
export type TCNSStimulationState = {
    stimulationId: string;
    entry: TCNSSignalJSON;
    status: ECNSStimulationStatus;
    progress: TCNSProgress;
    /**
     * Which scope (cns/graph) this stimulation belongs to. Unset ⇒ the single
     * default scope. Names are unique within a scope; resume reads this to route
     * to the right registry/cns.
     */
    scopeName?: string;
};
