import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import { CNSDTOReplayStartMessageSchema, type CNSDTOAppBatchMessage } from '@cnstra/devtools-dto';

export type CNSDevToolsTransportWsOptions = {
    /** WebSocket URL, e.g. ws://localhost:3141 */
    url: string;
    protocols?: string | string[];
    /** Reconnect delay in ms (default: 1000) */
    reconnectDelayMs?: number;
    /** Max buffered batch items before force flush (default: 100) */
    batchMaxSize?: number;
    /** Provide a WebSocket implementation for Node.js (e.g. `ws`) */
    webSocketImpl?: typeof WebSocket;
    /** Max reconnect attempts (default: Infinity) */
    maxReconnectAttempts?: number;
    consoleLogEnabled?: boolean;
};

export class CNSDevToolsTransportWs implements ICNSDevToolsTransport {
    private ws?: WebSocket;
    private connecting = false;
    private closed = false;
    private reconnectAttempts = 0;
    private hasConnectedOnce = false;

    private readonly pendingBatches: CNSDTOAppBatchMessage[] = [];
    private lastTopologyBatch?: CNSDTOAppBatchMessage;
    private onReplayHandler?: (cmd: any) => void;

    constructor(private readonly opts: CNSDevToolsTransportWsOptions) {}

    // ─── ICNSDevToolsTransport ────────────────────────────────────────────────────

    async sendBatch(message: CNSDTOAppBatchMessage): Promise<void> {
        if (message.items.some(i => i.type === 'topology')) {
            this.lastTopologyBatch = message;
        }
        this.pendingBatches.push(message);
        await this.flush();
    }

    onReplayStart(handler: (cmd: any) => void): () => void {
        this.onReplayHandler = handler;
        return () => { this.onReplayHandler = undefined; };
    }

    // ─── Connection management ────────────────────────────────────────────────────

    private get WS(): typeof WebSocket {
        const impl = this.opts.webSocketImpl
            ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
        if (!impl) throw new Error('No WebSocket implementation. Pass webSocketImpl option.');
        return impl;
    }

    private ensureSocket(): Promise<void> {
        if (this.ws?.readyState === 1) return Promise.resolve();
        if (this.connecting) {
            return new Promise(resolve => {
                const poll = () => this.ws?.readyState === 1 ? resolve() : setTimeout(poll, 50);
                poll();
            });
        }
        this.connecting = true;
        return new Promise(resolve => {
            const ws = new this.WS(this.opts.url, this.opts.protocols) as WebSocket;
            this.ws = ws;

            ws.onopen = () => {
                this.connecting = false;
                this.reconnectAttempts = 0;
                if (this.opts.consoleLogEnabled) console.log('[DevTools] Connected');

                if (this.hasConnectedOnce && this.lastTopologyBatch) {
                    this.pendingBatches.unshift(this.lastTopologyBatch);
                }
                this.hasConnectedOnce = true;
                this.flush().then(resolve);
            };

            ws.onclose = () => {
                this.connecting = false;
                if (!this.closed && this.reconnectAttempts < (this.opts.maxReconnectAttempts ?? Infinity)) {
                    this.reconnectAttempts++;
                    if (this.opts.consoleLogEnabled) {
                        console.log(`[DevTools] Disconnected, reconnecting (attempt ${this.reconnectAttempts})`);
                    }
                    setTimeout(() => this.ensureSocket().catch(() => {}), this.opts.reconnectDelayMs ?? 1000);
                } else if (this.reconnectAttempts >= (this.opts.maxReconnectAttempts ?? Infinity)) {
                    if (this.opts.consoleLogEnabled) console.log('[DevTools] Max reconnect attempts reached');
                }
            };

            ws.onerror = () => { try { ws.close(); } catch {} };

            ws.onmessage = (ev: MessageEvent) => {
                try {
                    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
                    if (msg?.type === 'replay.start') {
                        const result = CNSDTOReplayStartMessageSchema.safeParse(msg);
                        if (result.success) {
                            this.onReplayHandler?.(result.data);
                        } else if (this.opts.consoleLogEnabled) {
                            console.warn('[DevTools] Invalid replay.start message:', result.error.message);
                        }
                    }
                } catch {}
            };
        });
    }

    private async flush(): Promise<void> {
        if (this.pendingBatches.length === 0) return;
        await this.ensureSocket();
        if (this.ws?.readyState !== 1) return;

        const batches = this.pendingBatches.splice(0, this.pendingBatches.length);
        if (batches.length === 0) return;
        try {
            const items = batches.flatMap(b => b.items);
            if (items.length === 0) return;
            this.ws.send(JSON.stringify({ type: 'batch', items }));
        } catch {
            this.pendingBatches.unshift(...batches);
        }
    }

    close(): void {
        this.closed = true;
        try { this.ws?.close(); } catch {}
        this.ws = undefined;
    }

    get isConnected(): boolean {
        return this.ws?.readyState === 1;
    }
}
