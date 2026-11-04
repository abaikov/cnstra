import { CNSServerMessageDTOSchema } from '@cnstra/devtools-dto';
import type { TCNSClientMessageDTO, TCNSServerMessageDTO } from '@cnstra/devtools-dto';
import type { ICNSDevToolsSocket } from '../interfaces/ICNSDevToolsSocket';

export function socketRequest<TReply>(
    socket: ICNSDevToolsSocket,
    request: Extract<TCNSClientMessageDTO, { requestId: string }>,
    onReply: (reply: TCNSServerMessageDTO, resolve: (value: TReply) => void, reject: (error: Error) => void) => void,
    timeoutMs = 5000
): Promise<TReply> {
    return new Promise<TReply>((resolve, reject) => {
        let settled = false;
        let unsubscribe: (() => void) | null = null;
        const settle = (outcome: () => void): void => {
            if (settled) return;
            settled = true;
            unsubscribe?.();
            clearTimeout(timer);
            outcome();
        };
        const onFrame = (data: string): void => {
            let frame: unknown;
            try {
                frame = JSON.parse(data);
            } catch {
                return;
            }
            if (typeof frame !== 'object' || frame === null || !('requestId' in frame) || frame.requestId !== request.requestId) return;
            const reply = CNSServerMessageDTOSchema.safeParse(frame);
            if (!reply.success) return;
            onReply(
                reply.data,
                value => settle(() => resolve(value)),
                error => settle(() => reject(error))
            );
        };
        const timer = setTimeout(() => settle(() => reject(new Error('devtools request timed out'))), timeoutMs);

        unsubscribe = socket.subscribe(onFrame);
        if (!socket.send(request)) settle(() => reject(new Error('devtools socket send failed')));
    });
}
