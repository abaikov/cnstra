import type { ECNSStimulationStatus, ECNSStimulationTaskStatus } from '@cnstra/persist-dto';

export type TCNSPipeConnector = { status: ECNSStimulationStatus | ECNSStimulationTaskStatus | 'entry'; isFlowing: boolean };
