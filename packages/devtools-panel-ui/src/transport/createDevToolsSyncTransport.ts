import { CNSHomeostatTransductionChannel, CNSHomeostatTransductionFetch } from '@cnstra/sync';
import { CNS_DEVTOOLS_SYNC_PATH, CNSSyncResponseDTOSchema } from '@cnstra/devtools-dto';
import type { ICNSDevToolsSocket } from '../interfaces/ICNSDevToolsSocket';
import type { TCNSDevToolsSyncTransport } from '../types/TCNSDevToolsSyncTransport';

const parsedFrameOf = (frame: string): unknown => {
    try {
        return JSON.parse(frame);
    } catch {
        return undefined;
    }
};

export function createDevToolsSyncTransport(socket: ICNSDevToolsSocket, httpUrl: string): TCNSDevToolsSyncTransport {
    if (socket.transportKind === 'polling') {
        return { batchTransduceFn: new CNSHomeostatTransductionFetch({ url: `${httpUrl}${CNS_DEVTOOLS_SYNC_PATH}` }).batchTransduceFn, failPendingRequests: () => undefined };
    }
    const homeostatTransductionChannel = new CNSHomeostatTransductionChannel({
        sendRequest: request => {
            if (!socket.send({ type: 'sync.request', ...request })) throw new Error('the devtools connection is not open');
        },
    });
    socket.subscribe(frame => {
        const syncResponse = CNSSyncResponseDTOSchema.safeParse(parsedFrameOf(frame));
        if (syncResponse.success) homeostatTransductionChannel.receiveResponse(syncResponse.data);
    });
    return {
        batchTransduceFn: homeostatTransductionChannel.batchTransduceFn,
        failPendingRequests: error => homeostatTransductionChannel.failPendingRequests(error),
    };
}
