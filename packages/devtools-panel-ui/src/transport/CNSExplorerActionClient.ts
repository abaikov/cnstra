import type { TCNSSignalJSON, TCNSStimulationCommand } from '@cnstra/persist-dto';
import type { ICNSDevToolsSocket } from '../interfaces/ICNSDevToolsSocket';
import { socketRequest } from './socketRequest';

const createRequestId = (): string => `ex-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class CNSExplorerActionClient {
    constructor(private readonly socket: ICNSDevToolsSocket) {}

    launch(entry: TCNSSignalJSON): Promise<string> {
        return socketRequest<string>(this.socket, { type: 'stimulation.launch', requestId: createRequestId(), entry }, (reply, resolve, reject) => {
            if (reply.type === 'stimulation.launch.accepted') resolve(reply.newStimulationId);
            else if (reply.type === 'stimulation.launch.rejected') reject(new Error(reply.reason));
        });
    }

    command(stimulationId: string, command: TCNSStimulationCommand): Promise<void> {
        return socketRequest<void>(this.socket, { type: 'stimulation.command', requestId: createRequestId(), stimulationId, command }, (reply, resolve, reject) => {
            if (reply.type === 'stimulation.command.accepted') resolve(undefined);
            else if (reply.type === 'stimulation.command.rejected') reject(new Error(reply.reason));
        });
    }

    retry(stimulationId: string): Promise<void> {
        return socketRequest<void>(this.socket, { type: 'stimulation.retry', requestId: createRequestId(), stimulationId }, (reply, resolve, reject) => {
            if (reply.type === 'stimulation.retry.accepted') resolve(undefined);
            else if (reply.type === 'stimulation.retry.rejected') reject(new Error(reply.reason));
        });
    }

    clone(stimulationId: string): Promise<string> {
        return socketRequest<string>(this.socket, { type: 'stimulation.clone', requestId: createRequestId(), stimulationId }, (reply, resolve, reject) => {
            if (reply.type === 'stimulation.clone.accepted') resolve(reply.newStimulationId);
            else if (reply.type === 'stimulation.clone.rejected') reject(new Error(reply.reason));
        });
    }
}
