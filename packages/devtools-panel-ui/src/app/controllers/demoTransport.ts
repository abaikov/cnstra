import type { ICNSDevtoolsTransport, TCNSDevToolsTransportHooks } from './socket';

const browserProcess = {
    env: {},
    platform: 'browser',
    cwd: () => '/',
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
    stdout: { isTTY: false },
};

export function createDemoTransport(hooks: TCNSDevToolsTransportHooks): ICNSDevtoolsTransport {
    const globals = globalThis as { process?: unknown };
    globals.process ??= browserProcess;

    let disposed = false;
    let deliver: ((data: string) => void) | undefined;
    const pending: string[] = [];
    const panelSocket = {
        readyState: 1,
        send: (data: string) => queueMicrotask(() => !disposed && hooks.onMessage(data)),
    };
    const demo = import('../../demo/demoApp').then(({ startDevToolsDemo }) => {
        const app = startDevToolsDemo();
        if (disposed) return app;
        deliver = app.connect(panelSocket);
        hooks.onOpen();
        for (const data of pending.splice(0)) deliver(data);
        return app;
    });
    demo.catch(error => hooks.onError({ message: error instanceof Error ? error.message : String(error) }));

    return {
        send: data => {
            if (disposed) return false;
            if (deliver) deliver(data);
            else pending.push(data);
            return true;
        },
        dispose: () => {
            disposed = true;
            panelSocket.readyState = 0;
            void demo.then(app => app.disconnect(panelSocket), () => undefined);
        },
    };
}
