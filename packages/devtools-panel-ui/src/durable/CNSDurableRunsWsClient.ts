import type { ICNSDurableRunsClient } from './ICNSDurableRunsClient';
import type { TCNSDurableRunView } from './TCNSDurableRunView';
import type { DevtoolsSocket } from '../app/controllers/socket';

/**
 * WS-backed durable-runs client (Phase 2b-3): reads the name-based
 * Stimulation→Attempt→Task roster from the devtools-server over the SAME socket
 * the panel already uses, and drives retry/clone through the Phase 2b-2 messages.
 * Same {@link ICNSDurableRunsClient} seam as the HTTP admin client, so the exact
 * same page renders the live observability stream.
 *
 * There is no `launch` here — the panel observes an app; the app initiates
 * stimulations, not the panel. `launch` rejects and the page hides its button.
 */
const genId = (): string =>
    `dr-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const TIMEOUT_MS = 5000;

export class CNSDurableRunsWsClient implements ICNSDurableRunsClient {
    constructor(
        private readonly socket: DevtoolsSocket,
        private readonly getScopeName: () => string | undefined
    ) {}

    /** Send a message and resolve when a reply carrying the same requestId arrives. */
    private request<T>(
        message: Record<string, unknown> & { requestId: string },
        onReply: (
            msg: any,
            resolve: (v: T) => void,
            reject: (e: Error) => void
        ) => void
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const ws = this.socket.getSocket();
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
                TIMEOUT_MS
            );

            ws.addEventListener('message', onMsg);
            if (!this.socket.send(message as never)) {
                done(() => reject(new Error('devtools socket send failed')));
            }
        });
    }

    async listRuns(): Promise<TCNSDurableRunView[]> {
        return this.request<TCNSDurableRunView[]>(
            {
                type: 'cns.stimulations.query',
                requestId: genId(),
                scopeName: this.getScopeName(),
            },
            (m, resolve) => {
                if (m.type === 'cns.stimulations.result')
                    resolve(m.runs as TCNSDurableRunView[]);
            }
        );
    }

    async info(): Promise<{ backend: string }> {
        return { backend: 'devtools (live)' };
    }

    async launch(): Promise<string> {
        throw new Error('launch is not available in observability mode');
    }

    async retry(runId: string): Promise<void> {
        await this.request<void>(
            {
                type: 'stimulation.retry',
                requestId: genId(),
                stimulationId: runId,
            },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.retry.accepted') resolve(undefined);
                else if (m.type === 'stimulation.retry.rejected')
                    reject(new Error(m.reason ?? 'retry rejected'));
            }
        );
    }

    async clone(runId: string): Promise<string> {
        return this.request<string>(
            {
                type: 'stimulation.clone',
                requestId: genId(),
                stimulationId: runId,
            },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.clone.accepted')
                    resolve(m.newStimulationId as string);
                else if (m.type === 'stimulation.clone.rejected')
                    reject(new Error(m.reason ?? 'clone rejected'));
            }
        );
    }
}
