import type { TCNSSignalJSON } from '../types/TCNSSignalJSON';

export type TCNSStimulationLaunchRequest = {
    type: 'stimulation.launch';
    requestId: string;
    entry: TCNSSignalJSON;
};
