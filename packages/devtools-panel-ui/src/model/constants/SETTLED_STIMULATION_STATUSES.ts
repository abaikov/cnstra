import type { ECNSStimulationStatus } from '@cnstra/persist-dto';

export const SETTLED_STIMULATION_STATUSES: ReadonlySet<ECNSStimulationStatus> = new Set<ECNSStimulationStatus>(['completed', 'failed', 'aborted']);
