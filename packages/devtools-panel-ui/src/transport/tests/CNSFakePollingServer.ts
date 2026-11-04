import type { TCNSPollingFetch } from '../../types/TCNSPollingFetch';

export class CNSFakePollingServer {
    public readonly calls: Array<{ method: string; url: string; body?: string }> = [];
    private readonly parked: Array<(messages: string[]) => void> = [];

    public readonly fetch: TCNSPollingFetch = (input, init) => {
        const method = init.method ?? 'GET';
        this.calls.push({ method, url: input, body: typeof init.body === 'string' ? init.body : undefined });
        if (method !== 'GET') return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
        return new Promise<Awaited<ReturnType<TCNSPollingFetch>>>(resolve => {
            this.parked.push(messages => resolve({ ok: true, status: 200, json: async () => ({ messages }) }));
        });
    };

    public static async flush(turns = 12): Promise<void> {
        for (let turn = 0; turn < turns; turn++) await Promise.resolve();
    }

    public gets(): Array<{ method: string; url: string; body?: string }> {
        return this.calls.filter(call => call.method === 'GET');
    }

    public posts(): Array<{ method: string; url: string; body?: string }> {
        return this.calls.filter(call => call.method === 'POST');
    }

    public deletes(): Array<{ method: string; url: string; body?: string }> {
        return this.calls.filter(call => call.method === 'DELETE');
    }

    public async reply(...messages: string[]): Promise<void> {
        const answer = this.parked.shift();
        if (!answer) throw new Error('no poll in flight');
        answer(messages);
        await CNSFakePollingServer.flush();
    }

    public install(): () => void {
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
        Object.defineProperty(globalThis, 'fetch', { value: this.fetch, configurable: true, writable: true });
        return () => {
            if (previous) Object.defineProperty(globalThis, 'fetch', previous);
            else Reflect.deleteProperty(globalThis, 'fetch');
        };
    }
}
