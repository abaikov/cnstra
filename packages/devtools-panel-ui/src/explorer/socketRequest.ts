import type { DevtoolsSocket } from '../app/controllers/socket';

/**
 * Send one message over the devtools connection and resolve when a reply carrying
 * the same `requestId` arrives (or reject on timeout / send failure). Shared by
 * every request/reply client so the correlation + cleanup plumbing lives in one
 * place — and, since it only ever sees frames as strings, it correlates the same
 * way whether the frames came over the socket or over HTTP polling.
 */
export function socketRequest<T>(
    socket: DevtoolsSocket,
    message: Record<string, unknown> & { requestId: string },
    onReply: (
        msg: any,
        resolve: (v: T) => void,
        reject: (e: Error) => void
    ) => void,
    timeoutMs = 5000
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        let unsubscribe: (() => void) | null = null;
        const cleanup = () => {
            unsubscribe?.();
            clearTimeout(timer);
        };
        const done = (fn: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
        };
        const onFrame = (data: string) => {
            let m: any;
            try {
                m = JSON.parse(data);
            } catch {
                return;
            }
            if (!m || m.requestId !== message.requestId) return;
            onReply(
                m,
                v => done(() => resolve(v)),
                e => done(() => reject(e))
            );
        };
        const timer = setTimeout(
            () => done(() => reject(new Error('devtools request timed out'))),
            timeoutMs
        );

        unsubscribe = socket.subscribe(onFrame);
        if (!socket.send(message as never)) {
            done(() => reject(new Error('devtools socket send failed')));
        }
    });
}
