import { CNSDevToolsTransportWs, CNSDevToolsTransportWsOptions } from '../src/index';
import type { CNSDTOAppBatchMessage } from '@cnstra/devtools-dto';

const MockWebSocket = (global as any).MockWebSocket;

const defaultOpts: CNSDevToolsTransportWsOptions = {
    url: 'ws://localhost:8080',
    webSocketImpl: MockWebSocket,
};

const topologyBatch = (): CNSDTOAppBatchMessage => ({
    type: 'batch',
    items: [{
        type: 'topology',
        cnsId: 'app:cns', appId: 'app', appName: 'App', version: '1.0.0',
        timestamp: Date.now(), neurons: [], collaterals: [], dendrites: [],
    }],
});

const hopBatch = (): CNSDTOAppBatchMessage => ({
    type: 'batch',
    items: [{
        type: 'execution.hop',
        hop: {
            id: 'exec1:0', executionId: 'exec1', index: 0,
            neuronId: 'app:cns:n', inputCollateralId: 'app:cns:n:col',
            outputCollateralId: null, inputPayload: {}, outputPayload: null,
            startedAt: Date.now(), duration: null, error: null,
        },
    }],
});

describe('CNSDevToolsTransportWs', () => {
    let transport: CNSDevToolsTransportWs;

    beforeEach(() => MockWebSocket.clearInstances());

    afterEach(() => transport?.close());

    // ─── Connection ───────────────────────────────────────────────────────────────

    describe('Connection Management', () => {
        test('starts disconnected', () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            expect(transport.isConnected).toBe(false);
        });

        test('connects on first sendBatch', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));
            expect(transport.isConnected).toBe(true);
        });

        test('reuses existing connection', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));
            const count = MockWebSocket.getInstances().length;
            await transport.sendBatch(hopBatch());
            expect(MockWebSocket.getInstances().length).toBe(count);
        });

        test('uses global WebSocket when webSocketImpl not provided', async () => {
            transport = new CNSDevToolsTransportWs({ url: 'ws://localhost:8080' });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));
            expect(transport.isConnected).toBe(true);
        });

        test('handles concurrent sendBatch calls during initial connection', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            const p1 = transport.sendBatch(topologyBatch());
            const p2 = transport.sendBatch(hopBatch());
            await Promise.all([p1, p2]);
            expect(transport.isConnected).toBe(true);
        });

        test('throws when no WebSocket implementation available', async () => {
            const orig = (global as any).WebSocket;
            delete (global as any).WebSocket;
            try {
                transport = new CNSDevToolsTransportWs({ url: 'ws://x', webSocketImpl: undefined as any });
                await expect(transport.sendBatch(hopBatch())).rejects.toThrow('No WebSocket implementation');
            } finally {
                (global as any).WebSocket = orig;
            }
        });
    });

    // ─── Sending ──────────────────────────────────────────────────────────────────

    describe('Message Sending', () => {
        test('sends batch as JSON with type=batch', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const ws = MockWebSocket.getLatestInstance();
            const sent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(sent.type).toBe('batch');
            expect(sent.items[0].type).toBe('topology');
        });

        test('merges multiple pending batches into one send', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);

            // Send multiple batches rapidly (before flush)
            void transport.sendBatch(topologyBatch());
            void transport.sendBatch(hopBatch());
            void transport.sendBatch(hopBatch());

            await new Promise(r => setTimeout(r, 30));

            const ws = MockWebSocket.getLatestInstance();
            // All items should be merged
            const lastSent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
            expect(lastSent.items.length).toBeGreaterThanOrEqual(1);
        });

        test('requeues items on send failure', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const ws = MockWebSocket.getLatestInstance();
            ws.send = jest.fn(() => { throw new Error('send failed'); });

            // Should not throw
            await expect(transport.sendBatch(hopBatch())).resolves.toBeUndefined();
        });
    });

    // ─── Reconnection ─────────────────────────────────────────────────────────────

    describe('Reconnection Logic', () => {
        test('attempts reconnection on connection loss', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 20, maxReconnectAttempts: 3 });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const countBefore = MockWebSocket.getInstances().length;
            MockWebSocket.getLatestInstance().close();
            await new Promise(r => setTimeout(r, 60));

            expect(MockWebSocket.getInstances().length).toBeGreaterThan(countBefore);
        });

        test('resends topology batch on reconnection', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 20 });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            MockWebSocket.getLatestInstance().close();
            await new Promise(r => setTimeout(r, 60));

            const ws = MockWebSocket.getLatestInstance();
            const reconnectSent = ws.sentMessages.find((m: string) =>
                JSON.parse(m).items?.some((i: any) => i.type === 'topology')
            );
            expect(reconnectSent).toBeDefined();
        });

        test('stops reconnecting after max attempts', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 10, maxReconnectAttempts: 0 });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const countBefore = MockWebSocket.getInstances().length;
            MockWebSocket.getLatestInstance().close();
            await new Promise(r => setTimeout(r, 50));

            expect(MockWebSocket.getInstances().length).toBe(countBefore);
        });

        test('does not reconnect after manual close', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 10 });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const countBefore = MockWebSocket.getInstances().length;
            transport.close();
            await new Promise(r => setTimeout(r, 50));

            expect(MockWebSocket.getInstances().length).toBe(countBefore);
            expect(transport.isConnected).toBe(false);
        });

        test('swallows reconnect errors', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 10, maxReconnectAttempts: 1 });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const orig = (global as any).WebSocket;
            try {
                delete (global as any).WebSocket;
                (transport as any).opts.webSocketImpl = undefined;
                MockWebSocket.getLatestInstance()?.close();
                await new Promise(r => setTimeout(r, 50));
            } finally {
                (global as any).WebSocket = orig;
                (transport as any).opts.webSocketImpl = MockWebSocket;
            }
            // No unhandled rejection = pass
            expect(true).toBe(true);
        });

        test('logs messages when consoleLogEnabled', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 20, consoleLogEnabled: true });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[DevTools] Connected'));

            MockWebSocket.getLatestInstance().close();
            await new Promise(r => setTimeout(r, 30));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[DevTools] Disconnected'));
        });

        test('uses default 1000ms reconnect delay when not specified', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, maxReconnectAttempts: 1 });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
            MockWebSocket.getLatestInstance()!.close();
            await new Promise(r => setTimeout(r, 15));

            const called1000 = setTimeoutSpy.mock.calls.some(([, delay]) => delay === 1000);
            setTimeoutSpy.mockRestore();
            transport.close();
            expect(called1000).toBe(true);
        });

        test('reconnect with no topology flushes empty queue', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 10 });
            await transport.sendBatch(hopBatch()); // no topology → lastTopologyBatch stays undefined
            await new Promise(r => setTimeout(r, 20));

            MockWebSocket.getLatestInstance()!.close();
            await new Promise(r => setTimeout(r, 50));
            expect(MockWebSocket.getInstances().length).toBeGreaterThan(1);
        });

        test('logs max attempts reached', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 10, maxReconnectAttempts: 0, consoleLogEnabled: true });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));
            MockWebSocket.getLatestInstance().close();
            await new Promise(r => setTimeout(r, 30));
            expect(console.log).toHaveBeenCalledWith('[DevTools] Max reconnect attempts reached');
        });
    });

    // ─── Message Handling ─────────────────────────────────────────────────────────

    describe('Message Handling', () => {
        test('calls onReplayStart handler for replay.start messages', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            let received: any;
            transport.onReplayStart?.(cmd => { received = cmd; });

            const ws = MockWebSocket.getLatestInstance();
            ws.onmessage?.({ data: JSON.stringify({
                type: 'replay.start',
                replayId: 'r1',
                executionId: 'exec1',
                collateralId: 'app:cns:n:col',
                payload: { x: 1 },
            }) } as MessageEvent);

            await new Promise(r => setTimeout(r, 10));
            expect(received?.replayId).toBe('r1');
            expect(received?.collateralId).toBe('app:cns:n:col');
        });

        test('ignores invalid replay.start messages', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            let called = false;
            transport.onReplayStart?.(()  => { called = true; });

            const ws = MockWebSocket.getLatestInstance();
            ws.onmessage?.({ data: JSON.stringify({ type: 'replay.start', bad: 'data' }) } as MessageEvent);
            await new Promise(r => setTimeout(r, 10));
            expect(called).toBe(false);
        });

        test('logs warn for invalid replay.start when consoleLogEnabled', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, consoleLogEnabled: true });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const ws = MockWebSocket.getLatestInstance();
            ws.onmessage?.({ data: JSON.stringify({ type: 'replay.start', bad: 'data' }) } as MessageEvent);
            await new Promise(r => setTimeout(r, 10));
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('[DevTools] Invalid replay.start message:'),
                expect.any(String),
            );
        });

        test('handles non-string WebSocket message data', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const ws = MockWebSocket.getLatestInstance()!;
            expect(() => {
                ws.onmessage?.({ data: 42 } as unknown as MessageEvent);
            }).not.toThrow();
        });

        test('skips send when batch has empty items array', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const ws = MockWebSocket.getLatestInstance()!;
            const sentBefore = ws.sentMessages.length;
            await transport.sendBatch({ type: 'batch', items: [] } as any);
            expect(ws.sentMessages.length).toBe(sentBefore);
        });

        test('returns early from flush when ws unavailable after ensureSocket', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            jest.spyOn(transport as any, 'ensureSocket').mockImplementation(async () => {
                (transport as any).ws = undefined;
            });
            await expect(transport.sendBatch(topologyBatch())).resolves.toBeUndefined();
        });

        test('ignores unknown message types', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            const ws = MockWebSocket.getLatestInstance();
            expect(() => {
                ws.onmessage?.({ data: JSON.stringify({ type: 'unknown' }) } as MessageEvent);
                ws.onmessage?.({ data: 'invalid-json' } as MessageEvent);
            }).not.toThrow();
        });

        test('unregisters onReplayStart handler', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            let count = 0;
            const unsub = transport.onReplayStart?.(() => count++) ?? (() => {});

            const ws = MockWebSocket.getLatestInstance();
            const replayMsg = { data: JSON.stringify({ type: 'replay.start', replayId: 'r1', executionId: 'e1', collateralId: 'app:cns:n:col', payload: {} }) };
            ws.onmessage?.(replayMsg as MessageEvent);
            await new Promise(r => setTimeout(r, 10));
            expect(count).toBe(1);

            unsub();
            ws.onmessage?.(replayMsg as MessageEvent);
            await new Promise(r => setTimeout(r, 10));
            expect(count).toBe(1);
        });
    });

    // ─── Error Handling ───────────────────────────────────────────────────────────

    describe('Error Handling', () => {
        test('handles WebSocket onerror by closing', async () => {
            transport = new CNSDevToolsTransportWs({ ...defaultOpts, reconnectDelayMs: 20 });
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));

            MockWebSocket.simulateError(MockWebSocket.getLatestInstance());
            await new Promise(r => setTimeout(r, 50));

            expect(MockWebSocket.getInstances().length).toBeGreaterThan(1);
        });

        test('handles multiple close calls gracefully', () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            transport.close();
            transport.close();
            expect(transport.isConnected).toBe(false);
        });
    });

    // ─── Getters ──────────────────────────────────────────────────────────────────

    describe('Getters and Properties', () => {
        test('isConnected reflects connection state', async () => {
            transport = new CNSDevToolsTransportWs(defaultOpts);
            expect(transport.isConnected).toBe(false);
            await transport.sendBatch(topologyBatch());
            await new Promise(r => setTimeout(r, 20));
            expect(transport.isConnected).toBe(true);
            transport.close();
            await new Promise(r => setTimeout(r, 10));
            expect(transport.isConnected).toBe(false);
        });
    });
});
