import type { TCNSStimulationAttempt, TCNSStimulationRosterRow, TCNSStimulationTask } from '@cnstra/persist-dto';

export type TCNSExplorerSnapshot = {
    stimulations: TCNSStimulationRosterRow[];
    attempts: TCNSStimulationAttempt[];
    tasks: TCNSStimulationTask[];
};
