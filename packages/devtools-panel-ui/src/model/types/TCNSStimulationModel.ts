import type { TCNSHomeostatModels } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatModelHandles } from '@cnstra/oimdb';
import type { defineStimulationModel } from '../defineStimulationModel';

export type TCNSStimulationModel = TCNSHomeostatModels<{ stimulationModel: ReturnType<typeof defineStimulationModel> }, ICNSOIMDBHomeostatModelHandles>['stimulationModel'];
