import type {
    TCNSAppBatchMessageDTO,
    TCNSReplayStartMessageDTO,
    TCNSAppCommandDTO,
} from '@cnstra/devtools-dto';

export interface ICNSDevToolsTransport {
    sendBatch(message: TCNSAppBatchMessageDTO): Promise<void>;
    onReplayStart?(handler: (cmd: TCNSReplayStartMessageDTO) => void): () => void;
    /**
     * Server→app resumable-action commands (retry/clone, Phase 2b-2). The server
     * enriches the UI's thin request from the resumable store and forwards a
     * resume/launch command here; the app hydrates + re-runs the stimulation.
     */
    onStimulationCommand?(
        handler: (cmd: TCNSAppCommandDTO) => void
    ): () => void;
}
