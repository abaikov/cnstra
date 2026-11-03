import type { TCNSScheduledStimulationState } from './TCNSScheduledStimulationState';
import type { TCNSScheduledStimulationTypeState } from './TCNSScheduledStimulationTypeState';
import type { TCNSStimulationScheduleState } from './TCNSStimulationScheduleState';

export type TCNSScheduledStimulationPage = {
    rows: TCNSScheduledStimulationState[];
    schedules: TCNSStimulationScheduleState[];
    types: TCNSScheduledStimulationTypeState[];
    nextCursor: string | null;
};
