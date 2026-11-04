import type { TCNSClientMessageDTO } from '@cnstra/devtools-dto';
import type { TCNSDevToolsConnectionHooks } from '../types/TCNSDevToolsConnectionHooks';
import type { TCNSDevToolsTransportKind } from '../types/TCNSDevToolsTransportKind';

export interface ICNSDevToolsSocket {
    readonly transportKind: TCNSDevToolsTransportKind;
    subscribe(listener: (data: string) => void): () => void;
    connect(connectionHooks: TCNSDevToolsConnectionHooks): void;
    send(message: TCNSClientMessageDTO): boolean;
    dispose(): void;
}
