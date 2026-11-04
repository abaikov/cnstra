import type { TCNSHomeostatModels } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatModelHandles } from '@cnstra/oimdb';
import type { defineScheduledStimulationModel } from '../defineScheduledStimulationModel';

export type TCNSScheduledStimulationModel = TCNSHomeostatModels<
    { scheduledStimulationModel: ReturnType<typeof defineScheduledStimulationModel> },
    ICNSOIMDBHomeostatModelHandles
>['scheduledStimulationModel'];
