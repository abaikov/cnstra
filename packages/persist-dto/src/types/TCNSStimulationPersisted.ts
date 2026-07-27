import type { TCNSSignalRef } from './TCNSSignalRef';
import type { TCNSStimulationStatus } from './TCNSStimulationStatus';
import type { TCNSProgress } from './TCNSProgress';

/**
 * The stable logical stimulation — the durable-execution unit a human sees and can
 * retry. Groups one or more attempts under a single stable `stimulationId` (= the
 * resume key threaded across a process boundary). `progress` is the live resume
 * state, mutated by whichever attempt is currently active; `entry` is the
 * originating signal, kept so a fresh **Clone** can be launched from scratch.
 *
 * Defined independently of {@link TCNSStimulationDto} — the persisted entity is its
 * own richer type, not a "persisted DTO". Storage bookkeeping (created/updated
 * timestamps, TTL, job lifecycle) belongs to the repository envelope, not here.
 */
export type TCNSStimulationPersisted = {
    stimulationId: string;
    entry: TCNSSignalRef;
    status: TCNSStimulationStatus;
    progress: TCNSProgress;
    /**
     * Which scope (cns/graph) this stimulation belongs to. Unset ⇒ the single
     * default scope. Names are unique within a scope; resume reads this to route
     * to the right registry/cns.
     */
    scopeName?: string;
};
