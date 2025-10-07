import { StimulationMessage } from './StimulationMessage';

export interface StimulationBatchMessage {
    type: 'stimulation-batch';
    stimulations: StimulationMessage[];
}