import type { TCNSSignalRef, TCNSStimulationVolume } from '@cnstra/persist-dto';
import type { CNSPersistOptionsRegistry } from '../CNSPersistOptionsRegistry';
import type { ICNSStimulationWriter } from '../interfaces/ICNSStimulationRepository';
import type { ICNSProgressRecordingStrategy } from '../interfaces/ICNSProgressRecordingStrategy';

/**
 * Construction inputs for a {@link ICNSStimulationPersistor}: the identity of the
 * attempt being recorded, the name registry (to serialize the frontier and resolve
 * task neurons/collaterals), where to write, how much to write (volume), and when to
 * flush (cadence strategy).
 */
export type TCNSStimulationPersistorOptions = {
    /** Where to write — only the write side is needed (see {@link ICNSStimulationWriter}). */
    repository: ICNSStimulationWriter;
    /** Name ↔ object registry — serializes the frontier and resolves task names. */
    registry: CNSPersistOptionsRegistry;

    // identity of this attempt
    stimulationId: string;
    stimulationAttemptId: string;
    attemptNumber: number;
    /** The signal(s) this attempt was activated with (frontier slots `0..k-1`). */
    entry: TCNSSignalRef[];

    /**
     * Which scope (cns/graph) the stimulation belongs to. Unset ⇒ the single default
     * scope. Written onto the stable stimulation record so resume can route.
     */
    scopeName?: string;

    /** How much to record. Defaults to `'progress'` (resume-only). */
    volume?: TCNSStimulationVolume;
    /** When to persist. Defaults to CNSDebouncedProgressRecordingStrategy. */
    strategy?: ICNSProgressRecordingStrategy;
};
