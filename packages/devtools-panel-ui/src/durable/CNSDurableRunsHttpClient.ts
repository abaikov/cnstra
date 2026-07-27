import type { ICNSDurableRunsClient } from './ICNSDurableRunsClient';
import type { TCNSDurableRunView } from './TCNSDurableRunView';

/**
 * HTTP polling implementation of ICNSDurableRunsClient — talks to the durable-runs
 * handler (examples/src/admin/durable-http-handler.ts, CORS-open). The page polls
 * `listRuns()`; the three actions POST and the next poll shows the result.
 */
export class CNSDurableRunsHttpClient implements ICNSDurableRunsClient {
    constructor(private readonly baseUrl: string) {}

    private async get<T>(path: string): Promise<T> {
        const res = await fetch(this.baseUrl + path);
        if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
        return res.json() as Promise<T>;
    }

    private async post<T>(path: string, body: unknown): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
        });
        if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
        return res.json() as Promise<T>;
    }

    listRuns(): Promise<TCNSDurableRunView[]> {
        return this.get<TCNSDurableRunView[]>('/api/runs');
    }
    info(): Promise<{ backend: string }> {
        return this.get<{ backend: string }>('/api/info');
    }
    async launch(params: { fail: boolean; userId?: string }): Promise<string> {
        return (await this.post<{ runId: string }>('/api/launch', params)).runId;
    }
    async retry(runId: string): Promise<void> {
        await this.post<{ ok: true }>('/api/retry', { runId });
    }
    async clone(runId: string): Promise<string> {
        return (await this.post<{ runId: string }>('/api/clone', { runId })).runId;
    }
}
