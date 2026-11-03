// The id grammar of the resumable model: an attempt id is
// `<stimulationId>#<attemptNumber>`; a cloned stimulation gets a fresh unique id.
//
// It lives beside the model rather than in the devtools because everything that
// mints these ids has to agree — the brokers that turn a job into a stimulation,
// the server that mints a retry, the panel that reads them back. A second copy of
// the format is a second thing to keep in sync.

/** The attempt id for attempt `n` of a stimulation: `<stimulationId>#<n>`. */
export function buildCNSAttemptId(stimulationId: string, attemptNumber: number): string {
    return `${stimulationId}#${attemptNumber}`;
}

/**
 * A fresh stimulation id for a **clone** of `srcStimulationId`.
 *
 * The timestamp alone is not enough: two clones of the same run minted inside
 * one millisecond would collide, and the second would silently upsert over the
 * first. A per-process counter breaks the tie without needing a uuid dependency
 * or a store round-trip.
 */
let cloneSequence = 0;

export function buildCNSCloneId(srcStimulationId: string): string {
    cloneSequence = (cloneSequence + 1) % 0xffffffff;
    return `${srcStimulationId}-clone-${Date.now()}-${cloneSequence.toString(36)}`;
}
