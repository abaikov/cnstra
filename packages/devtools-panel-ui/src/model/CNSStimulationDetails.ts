import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';
import { CNSExplorerSyncKeys } from './CNSExplorerSyncKeys';
import type { TCNSStimulationModel } from './types/TCNSStimulationModel';

export class CNSStimulationDetails {
    public static read(stimulationDetails: TCNSStimulationModel['summaries']['stimulationDetail'], stimulationId: string): TCNSDevToolsSyncData['stimulationDetail'] | undefined {
        return stimulationDetails.getSlotByKey(CNSExplorerSyncKeys.stimulationDetail(stimulationId)).entity;
    }

    public static peek(stimulationDetails: TCNSStimulationModel['summaries']['stimulationDetail'], stimulationId: string): TCNSDevToolsSyncData['stimulationDetail'] | undefined {
        return stimulationDetails.peekSlotByKey(CNSExplorerSyncKeys.stimulationDetail(stimulationId))?.entity;
    }
}
