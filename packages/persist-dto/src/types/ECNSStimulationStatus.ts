/**
 * Lifecycle status of a run or one of its stimulation attempts.
 *
 * `aborted` is deliberately distinct from `failed`: a run killed by a deploy,
 * a scale-down or a shutdown drain is not a business failure, and an operator
 * retries the two in completely different ways — the aborted ones in bulk,
 * the failed ones one at a time after reading why.
 */
export type ECNSStimulationStatus =
    | 'running'
    | 'completed'
    | 'failed'
    | 'aborted';
