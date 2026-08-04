import type { ICNSDurableStimulationsClient } from './ICNSDurableStimulationsClient';
import type { TCNSStimulationViewDTO } from '@cnstra/devtools-dto';

/**
 * HTTP polling implementation of ICNSDurableStimulationsClient — talks to the durable-runs
 * handler (examples/src/admin/durable-http-handler.ts, CORS-open). The page polls
 * `listStimulations()`; the three actions POST and the next poll shows the result.
 */
export class CNSDurableStimulationsHttpClient implements ICNSDurableStimulationsClient {
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

    listStimulations(): Promise<TCNSStimulationViewDTO[]> {
        return this.get<TCNSStimulationViewDTO[]>('/api/stimulations');
    }
    info(): Promise<{ backend: string }> {
        return this.get<{ backend: string }>('/api/info');
    }
    async launch(params: { fail: boolean; userId?: string }): Promise<string> {
        return (await this.post<{ stimulationId: string }>('/api/launch', params)).stimulationId;
    }
    async retry(stimulationId: string): Promise<void> {
        await this.post<{ ok: true }>('/api/retry', { stimulationId });
    }
    async clone(stimulationId: string): Promise<string> {
        return (await this.post<{ stimulationId: string }>('/api/clone', { stimulationId })).stimulationId;
    }
}
