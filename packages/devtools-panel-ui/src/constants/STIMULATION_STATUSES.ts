import type { ECNSStimulationStatus } from '@cnstra/persist-dto';

const STIMULATION_STATUS_BY_NAME: { readonly [TStatus in ECNSStimulationStatus]: TStatus } = {
    completed: 'completed',
    failed: 'failed',
    running: 'running',
    aborted: 'aborted',
};

export const STIMULATION_STATUSES: readonly ECNSStimulationStatus[] = Object.values(STIMULATION_STATUS_BY_NAME);
