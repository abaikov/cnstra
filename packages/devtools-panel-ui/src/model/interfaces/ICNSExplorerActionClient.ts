import type { TCNSSignalJSON, TCNSStimulationCommand } from '@cnstra/persist-dto';

export interface ICNSExplorerActionClient {
    retry(stimulationId: string): Promise<void>;
    clone(stimulationId: string): Promise<string>;
    command(stimulationId: string, command: TCNSStimulationCommand): Promise<void>;
    launch(entry: TCNSSignalJSON): Promise<string>;
}
