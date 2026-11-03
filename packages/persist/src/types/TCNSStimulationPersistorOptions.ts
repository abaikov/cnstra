import type { TCNSSignalJSON, ECNSStimulationVolume } from '@cnstra/persist-dto';
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
    entry: TCNSSignalJSON[];
    /**
     * The `stimulationAttemptId` this attempt was forked from, when it was.
     *
     * A **Clone** mints a NEW `stimulationId`, so without this nothing ties it
     * back to what it was cloned from — the panel shows an orphan row and the
     * traces are two unrelated trees. A Retry shares the stimulation id and so
     * does not need it, but recording it there too makes the chain explicit.
     */
    replayOf?: string;

    /**
     * Which scope (cns/graph) the stimulation belongs to. Unset ⇒ the single default
     * scope. Written onto the stable stimulation record so resume can route.
     */
    scopeName?: string;

    /** How much to record. Defaults to `'progress'` (resume-only). */
    volume?: ECNSStimulationVolume;
    /**
     * Hold each hop until its write has landed (default `false`).
     *
     * With it, `onResponse` returns a promise and the engine parks the hop's
     * subscribers until the checkpoint is stored — no activation can run ahead of
     * an unwritten frontier, and a failed write fails the run.
     *
     * It flushes on every response and therefore ignores {@link strategy}: a
     * coalesced write cannot be a barrier for a response it may skip. Paying that
     * per hop is the price of the guarantee, which is why it is off by default.
     */
    barrier?: boolean;
    /** When to persist. Ignored when {@link barrier} is on. */
    strategy?: ICNSProgressRecordingStrategy;
};
