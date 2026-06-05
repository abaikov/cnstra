import type { CNSDTOAppBatchMessage, CNSDTOReplayStartMessage } from '@cnstra/devtools-dto';

export interface ICNSDevToolsTransport {
    sendBatch(message: CNSDTOAppBatchMessage): Promise<void>;
    onReplayStart?(handler: (cmd: CNSDTOReplayStartMessage) => void): () => void;
}
