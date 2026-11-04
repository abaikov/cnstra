import { createCNSDevToolsSocket } from '../socket';
import { CNSDevToolsPageConfig } from '../CNSDevToolsPageConfig';
import type { TCNSDevToolsConnectionStatus } from '../../types/TCNSDevToolsConnectionStatus';
import { CNSFakePollingServer } from './CNSFakePollingServer';

class CNSTestWebSocket extends EventTarget {
    public static readonly OPEN = 1;
    public readonly readyState = 0;
    public send(): void {}
    public close(): void {}
}

describe('devtools socket transport selection', () => {
    let statuses: TCNSDevToolsConnectionStatus[] = [];
    let uninstallFetch: () => void = () => undefined;
    const connectionHooks = { onStatus: (status: TCNSDevToolsConnectionStatus) => void statuses.push(status), onUiConfig: () => undefined };

    beforeAll(() => {
        Object.defineProperty(globalThis, 'WebSocket', { value: CNSTestWebSocket, configurable: true, writable: true });
    });

    beforeEach(() => {
        statuses = [];
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        uninstallFetch();
        window.history.replaceState({}, '', '/');
    });

    it('defaults to the WebSocket and makes no HTTP requests', async () => {
        const server = new CNSFakePollingServer();
        uninstallFetch = server.install();

        const socket = createCNSDevToolsSocket(CNSDevToolsPageConfig.read());
        socket.connect(connectionHooks);
        await CNSFakePollingServer.flush();

        expect(socket.transportKind).toBe('socket');
        expect(server.calls).toHaveLength(0);

        socket.dispose();
    });

    it('?transport=polling connects over HTTP and sends the handshake first', async () => {
        const server = new CNSFakePollingServer();
        uninstallFetch = server.install();
        window.history.replaceState({}, '', '/?transport=polling');

        const socket = createCNSDevToolsSocket(CNSDevToolsPageConfig.read());
        socket.connect(connectionHooks);
        await CNSFakePollingServer.flush();

        expect(socket.transportKind).toBe('polling');
        expect(statuses).toEqual(['connected']);
        expect(server.posts().map(post => post.body)).toEqual([JSON.stringify({ type: 'client.connect' })]);

        socket.dispose();
    });

    it('reports a ui.config frame through onUiConfig', async () => {
        const server = new CNSFakePollingServer();
        uninstallFetch = server.install();
        window.history.replaceState({}, '', '/?transport=polling');
        const uiConfigs: unknown[] = [];

        const socket = createCNSDevToolsSocket(CNSDevToolsPageConfig.read());
        socket.connect({ onStatus: () => undefined, onUiConfig: config => void uiConfigs.push(config) });
        await CNSFakePollingServer.flush();
        await server.reply(JSON.stringify({ type: 'ui.config', actions: { retry: false }, defaultWindowMs: 60_000 }));

        expect(uiConfigs).toEqual([{ actions: { retry: false }, defaultWindowMs: 60_000 }]);

        socket.dispose();
    });
});
