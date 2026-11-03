import type { ECNSScheduledStimulationStatus } from './ECNSScheduledStimulationStatus';
import type { TCNSPlannedTaskJSON } from './TCNSPlannedTaskJSON';
import type { TCNSSignalJSON } from './TCNSSignalJSON';

export type TCNSScheduledStimulationState = {
    stimulationId: string;
    entry: TCNSSignalJSON;
    status: ECNSScheduledStimulationStatus;
    runAfter: number;
    priority: number;
    attemptCount: number;
    resumes: boolean;
    tasks: TCNSPlannedTaskJSON[];
    jobKey?: string;
    jobGroup?: string;
};
