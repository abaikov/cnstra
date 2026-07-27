/**
 * Terminal status of a **history** task. Only settled tasks become task records;
 * the still-outstanding (pending/active) frontier lives in the run's progress, not
 * here.
 */
export type TCNSStimulationTaskStatus = 'done' | 'failed';
