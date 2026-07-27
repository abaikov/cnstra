/**
 * How much of a stimulation is durably recorded:
 * - `'progress'` — only the minimum to resume: the run's outstanding frontier +
 *   context snapshot. Cheap; the retry UI still renders the run over live topology,
 *   but past per-task history is not kept.
 * - `'full'` — additionally record every settled task, yielding a durable per-hop
 *   waterfall (persist becomes the run-of-record).
 *
 * Orthogonal to the cadence strategy (which decides *when* to flush). A flag for
 * now — promote to a strategy interface only if custom volume logic is needed.
 */
export type TCNSStimulationVolume = 'progress' | 'full';
