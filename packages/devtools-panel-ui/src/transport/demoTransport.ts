import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import type { TCNSDevToolsTransportHooks } from '../types/TCNSDevToolsTransportHooks';
import { CNSErrorMessage } from '../utils/CNSErrorMessage';

const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

export function createCNSDemoTransport(hooks: TCNSDevToolsTransportHooks): ICNSDevToolsTransport {
    if (!('process' in globalThis)) Object.assign(globalThis, { process: { cwd: () => '/' } });

    let disposed = false;
    let deliver: ((data: string) => void) | undefined;
    const pending: string[] = [];
    const panelSocket = {
        readyState: SOCKET_OPEN,
        send: (data: string) => queueMicrotask(() => !disposed && hooks.onMessage(data)),
    };
    const demo = import('./demo/demoApp').then(({ startDevToolsDemo }) => {
        const app = startDevToolsDemo();
        if (disposed) return app;
        deliver = app.connect(panelSocket);
        hooks.onOpen();
        for (const data of pending.splice(0)) deliver(data);
        return app;
    });
    demo.catch(error => hooks.onError({ message: CNSErrorMessage.of(error) }));

    return {
        send: data => {
            if (disposed) return false;
            if (deliver) deliver(data);
            else pending.push(data);
            return true;
        },
        dispose: () => {
            disposed = true;
            panelSocket.readyState = SOCKET_CLOSED;
            void demo.then(app => app.disconnect(panelSocket), () => undefined);
        },
    };
}
