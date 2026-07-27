import type {
    CNSDTOAppBatchMessage,
    CNSDTOReplayStartMessage,
    CNSDTOAppCommand,
} from '@cnstra/devtools-dto';

export interface ICNSDevToolsTransport {
    sendBatch(message: CNSDTOAppBatchMessage): Promise<void>;
    onReplayStart?(handler: (cmd: CNSDTOReplayStartMessage) => void): () => void;
    /**
     * Server→app durable-action commands (retry/clone, Phase 2b-2). The server
     * enriches the UI's thin request from the durable store and forwards a
     * resume/launch command here; the app hydrates + re-runs the stimulation.
     */
    onStimulationCommand?(
        handler: (cmd: CNSDTOAppCommand) => void
    ): () => void;
}
