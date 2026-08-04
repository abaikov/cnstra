import type { DevtoolsSocket } from '../app/controllers/socket';

/**
 * Send one message over the devtools socket and resolve when a reply carrying the
 * same `requestId` arrives (or reject on timeout / send failure). Shared by every
 * request/reply client so the correlation + cleanup plumbing lives in one place.
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
        const ws = socket.getSocket();
        if (!ws) return reject(new Error('devtools socket is not open'));

        let settled = false;
        const cleanup = () => {
            ws.removeEventListener('message', onMsg);
            clearTimeout(timer);
        };
        const done = (fn: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
        };
        const onMsg = (ev: MessageEvent) => {
            let m: any;
            try {
                m = JSON.parse(
                    typeof ev.data === 'string' ? ev.data : String(ev.data)
                );
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

        ws.addEventListener('message', onMsg);
        if (!socket.send(message as never)) {
            done(() => reject(new Error('devtools socket send failed')));
        }
    });
}
