import type { TCNSSignalRef } from './TCNSSignalRef';
import type { TCNSStimulationStatus } from './TCNSStimulationStatus';
import type { TCNSProgress } from './TCNSProgress';

/**
 * A stimulation in its **emit** form — before the durable layer assigns its identity.
 * Same data as {@link TCNSStimulationPersisted} minus the assigned `stimulationId`.
 */
export type TCNSStimulationDto = {
    /** Originating signal, by name — used to start attempt 1 / launch a Clone. */
    entry: TCNSSignalRef;
    status: TCNSStimulationStatus;
    /** Live resume state (outstanding frontier + context). Empty tasks ⇒ nothing to resume. */
    progress: TCNSProgress;
    /**
     * Which scope (cns/graph) this stimulation belongs to. Unset ⇒ the single
     * default scope. Names are unique within a scope; resume reads this to route
     * to the right registry/cns.
     */
    scopeName?: string;
};
