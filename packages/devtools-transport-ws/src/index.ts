import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import type {
    InitMessage,
    NeuronResponseMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
} from '@cnstra/devtools-dto';

export type TWSOpts = {
    /** ws://localhost:7777 or wss://... */
    url: string;
    /** Optional protocols */
    protocols?: string | string[];
    /** Reconnect delay in ms (default 1000) */
    reconnectDelayMs?: number;
    /** Max buffered messages before force flush (default 100) */
    bufferMaxSize?: number;
    /** Optional WebSocket implementation for Node (e.g., globalThis.WebSocket or ws) */
    webSocketImpl?: typeof WebSocket;
    /** Auto-connect on first message (default true) */
    autoConnect?: boolean;
    /** Max reconnect attempts (default Infinity) */
    maxReconnectAttempts?: number;
};

type WSLike = WebSocket;

export class CNSDevToolsTransportWs implements ICNSDevToolsTransport {
    private ws?: WSLike;
    private connecting = false;
    private closed = false;
    private readonly buffer: Array<{
        type: 'init' | 'response';
        payload: any;
    }> = [];

    // Store the latest init message for reconnect
    private lastInitMessage?: InitMessage;
    private hasConnectedOnce = false;
    private reconnectAttempts = 0;

    constructor(private readonly opts: TWSOpts) {}

    private get reconnectDelayMs() {
        return this.opts.reconnectDelayMs ?? 1000;
    }
    private get bufferMaxSize() {
        return this.opts.bufferMaxSize ?? 100;
    }
    private get maxReconnectAttempts() {
        return this.opts.maxReconnectAttempts ?? Infinity;
    }

    private ensureSocket(): Promise<void> {
        const WS: typeof WebSocket | undefined =
            this.opts.webSocketImpl ||
            (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
        if (!WS)
            return Promise.reject(
                new Error(
                    'WebSocket implementation is not available. Provide webSocketImpl.'
                )
            );
        if (this.ws && this.ws.readyState === 1)
            // OPEN = 1
            return Promise.resolve();
        if (this.connecting) {
            return new Promise(resolve => {
                const check = () => {
                    if (this.ws && this.ws.readyState === 1)
                        // OPEN = 1
                        return resolve();
                    setTimeout(check, 50);
                };
                check();
            });
        }
        this.connecting = true;
        return new Promise(resolve => {
            const ws = new WS(this.opts.url, this.opts.protocols) as WSLike;
            this.ws = ws;
            ws.onopen = () => {
                console.log('🔗 DevTools connected to server');
                this.connecting = false;
                this.reconnectAttempts = 0; // Reset on successful connection

                // On reconnect, resend init message first
                if (this.hasConnectedOnce && this.lastInitMessage) {
                    console.log('🔄 Reconnected - resending init message');
                    this.buffer.unshift({
                        type: 'init',
                        payload: this.lastInitMessage,
                    });
                }

                this.hasConnectedOnce = true;
                this.flush();
                resolve();
            };
            ws.onclose = () => {
                this.connecting = false;
                if (
                    !this.closed &&
                    this.reconnectAttempts < this.maxReconnectAttempts
                ) {
                    this.reconnectAttempts++;
                    console.log(
                        `🔄 DevTools disconnected, reconnecting... (attempt ${this.reconnectAttempts})`
                    );
                    setTimeout(
                        () => this.ensureSocket().catch(() => {}),
                        this.reconnectDelayMs
                    );
                } else if (
                    this.reconnectAttempts >= this.maxReconnectAttempts
                ) {
                    console.log('❌ DevTools max reconnect attempts reached');
                }
            };
            ws.onerror = () => {
                try {
                    ws.close();
                } catch {}
            };
            ws.onmessage = (ev: MessageEvent) => {
                try {
                    const data =
                        typeof ev.data === 'string' ? ev.data : '' + ev.data;
                    const msg = JSON.parse(data);
                    if (msg && msg.type === 'stimulate') {
                        const cmd = msg as StimulateCommand;
                        const ack: StimulateAccepted = {
                            type: 'stimulate-accepted',
                            stimulationCommandId: cmd.stimulationCommandId,
                            stimulationId: cmd.stimulationCommandId,
                        };
                        try {
                            this.ws?.send(JSON.stringify(ack));
                        } catch {}
                        this.onStimulate?.(cmd);
                    }
                } catch {
                    // ignore invalid messages
                }
            };
        });
    }

    async sendInitMessage(message: InitMessage): Promise<void> {
        // Store the latest init message for reconnects
        this.lastInitMessage = message;

        this.buffer.push({ type: 'init', payload: message });
        if (this.buffer.length >= this.bufferMaxSize) await this.flush();
        else void this.flush();
    }

    async sendNeuronResponseMessage(
        message: NeuronResponseMessage
    ): Promise<void> {
        this.buffer.push({ type: 'response', payload: message });
        if (this.buffer.length >= this.bufferMaxSize) await this.flush();
        else void this.flush();
    }

    private async flush(): Promise<void> {
        if (this.buffer.length === 0) return;
        await this.ensureSocket();
        if (!this.ws || this.ws.readyState !== 1) return; // OPEN = 1
        const items = this.buffer.splice(0, this.buffer.length);
        try {
            this.ws.send(JSON.stringify({ type: 'batch', items }));
        } catch {
            // requeue if send fails
            this.buffer.unshift(...items);
        }
    }

    private onStimulate?: (cmd: StimulateCommand) => void;
    onStimulateCommand(handler: (cmd: StimulateCommand) => void): () => void {
        this.onStimulate = handler;
        return () => {
            this.onStimulate = undefined;
        };
    }

    /** Close the connection and stop reconnecting */
    close(): void {
        this.closed = true;
        try {
            this.ws?.close();
        } catch {}
        this.ws = undefined;
    }

    /** Get connection status */
    get isConnected(): boolean {
        return this.ws?.readyState === 1; // OPEN = 1
    }

    /** Get buffered message count */
    get bufferSize(): number {
        return this.buffer.length;
    }
}
