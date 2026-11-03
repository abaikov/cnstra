import type { TCNSScheduledStimulationFilter } from '../types/TCNSScheduledStimulationFilter';
import type { TCNSScheduledStimulationPage } from '../types/TCNSScheduledStimulationPage';

export interface ICNSScheduledStimulationReader {
    list(filter: TCNSScheduledStimulationFilter, cursor: string | null, limit: number): Promise<TCNSScheduledStimulationPage>;
}
