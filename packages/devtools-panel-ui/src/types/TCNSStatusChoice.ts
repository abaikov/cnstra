import type { ECNSStimulationStatus } from '@cnstra/persist-dto';
import type { TCNSTone } from './TCNSTone';

export type TCNSStatusChoice = { status: ECNSStimulationStatus | undefined; label: string; tone: TCNSTone };
