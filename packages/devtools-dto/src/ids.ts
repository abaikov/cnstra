// The implicit id grammar shared by the producer, server, and panel: an attempt id
// is `<stimulationId>#<attemptNumber>`; a cloned stimulation gets a fresh unique id.
// Defined once here so the three packages agree on the convention.

/** The attempt id for attempt `n` of a stimulation: `<stimulationId>#<n>`. */
export function buildAttemptId(stimulationId: string, attemptNumber: number): string {
    return `${stimulationId}#${attemptNumber}`;
}

/** A fresh stimulation id for a **clone** of `srcStimulationId`. */
export function buildCloneId(srcStimulationId: string): string {
    return `${srcStimulationId}-clone-${Date.now()}`;
}
