import type { ECNSStimulationStatus } from '@cnstra/persist-dto';

export type TCNSStatusShare = { status: ECNSStimulationStatus; count: number; offsetPercent: number; sharePercent: number };
