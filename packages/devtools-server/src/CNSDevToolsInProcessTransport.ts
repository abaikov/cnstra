import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import { CNSAppCommandDTOSchema } from '@cnstra/devtools-dto';
import type { TCNSAppBatchMessageDTO, TCNSAppCommandDTO } from '@cnstra/devtools-dto';
import type { CNSDevToolsServer } from './index';
import type { TCNSDevToolsClientRole } from './TCNSDevToolsClientRole';

export class CNSDevToolsInProcessTransport implements ICNSDevToolsTransport {
    private readonly commandHandlers = new Set<(command: TCNSAppCommandDTO) => void>();
    private readonly client: { send(data: string): void; readyState: number; readonly role: TCNSDevToolsClientRole } = {
        readyState: 1,
        role: 'app',
        send: (data: string) => this.receive(data),
    };

    constructor(private readonly server: CNSDevToolsServer) {}

    async sendBatch(message: TCNSAppBatchMessageDTO): Promise<void> {
        try {
            await this.server.handleMessage(this.client, message);
        } catch (error) {
            console.error('[CNStra] the devtools server refused an in-process batch', error);
        }
    }

    onStimulationCommand(handler: (command: TCNSAppCommandDTO) => void): () => void {
        this.commandHandlers.add(handler);
        return () => {
            this.commandHandlers.delete(handler);
        };
    }

    close(): void {
        this.client.readyState = 3;
        this.server.removeClient(this.client);
        this.commandHandlers.clear();
    }

    private receive(data: string): void {
        const result = CNSAppCommandDTOSchema.safeParse(JSON.parse(data));
        if (!result.success) return;
        for (const handler of this.commandHandlers) handler(result.data);
    }
}
