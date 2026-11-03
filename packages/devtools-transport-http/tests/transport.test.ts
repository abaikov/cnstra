import {
    CNSDevToolsTransportHttp,
    TCNSDevToolsTransportHttpOptions,
} from '../src/index';
import type { TCNSAppBatchMessageDTO } from '@cnstra/devtools-dto';

const BASE_URL = 'http://localhost:8080';
const SESSION = 'app-test';
const ENDPOINT = `${BASE_URL}/__cnstra/poll?sessionId=${SESSION}`;

// ─── Fixtures ─────────────────────────────────────────────────────────────────────

const topologyBatch = (): TCNSAppBatchMessageDTO => ({
    type: 'batch',
    items: [
        {
            type: 'topology',
            cnsId: 'app:cns',
            appId: 'app',
            appName: 'App',
            version: '1.0.0',
            timestamp: Date.now(),
            neurons: [],
            collaterals: [],
            dendrites: [],
        },
    ],
});

const taskBatch = (): TCNSAppBatchMessageDTO => ({
    type: 'batch',
    items: [
        {
            type: 'cns.stimulation.task',
            data: {
                stimulationAttemptId: 'exec1#1',
                index: 0,
                neuronName: 'n',
                dendriteCollateralName: 'col',
                inputIndex: 0,
                output: null,
                status: 'done',
                error: null,
                startedAt: Date.now(),
                duration: null,
            },
        },
    ],
});

const resumeCommand = {
    type: 'cns.stimulation.resume',
    requestId: 'req1',
    stimulationId: 's1',
    stimulationAttemptId: 's1#2',
    attemptNumber: 2,
    entry: { collateralName: 'c', payload: {} },
    progress: { tasks: [] },
};

// ─── A fetch that needs no network ────────────────────────────────────────────────

/**
 * The real server PARKS a GET until it has something to hand over, so the fake
 * does the same: a GET with nothing planned for it stays pending until the test
 * `deliver`s, or until the transport aborts it.
 */
const jsonResponse = (body: unknown, status = 200): Response =>
    ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as unknown as Response);

type TPlannedGet = { error?: unknown; status?: number; body?: unknown };
type TPlannedPost = { error?: unknown; status?: number };

const createFetchFake = () => {
    const posts: { url: string; body: string }[] = [];
    const gets: string[] = [];
    const deletes: string[] = [];
    const parked: Array<(response: Response) => void> = [];
    const plannedGets: TPlannedGet[] = [];
    const plannedPosts: TPlannedPost[] = [];

    const fetchFake = ((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';

        if (method === 'POST') {
            posts.push({ url, body: String(init?.body) });
            const planned = plannedPosts.shift() ?? {};
            return planned.error
                ? Promise.reject(planned.error)
                : Promise.resolve(jsonResponse(null, planned.status ?? 204));
        }

        if (method === 'DELETE') {
            deletes.push(url);
            return Promise.resolve(jsonResponse(null, 204));
        }

        gets.push(url);
        const planned = plannedGets.shift();
        if (planned) {
            if (planned.error) return Promise.reject(planned.error);
            return Promise.resolve(
                jsonResponse(planned.body ?? { messages: [] }, planned.status ?? 200)
            );
        }
        return new Promise<Response>((resolve, reject) => {
            parked.push(resolve);
            init?.signal?.addEventListener('abort', () =>
                reject(new Error('aborted'))
            );
        });
    }) as unknown as typeof fetch;

    return {
        fetch: fetchFake,
        posts,
        gets,
        deletes,
        /** Answer the oldest parked GET with these protocol messages. */
        deliver(...messages: unknown[]): void {
            const answer = parked.shift();
            if (!answer) throw new Error('no parked GET to answer');
            answer(
                jsonResponse({
                    messages: messages.map(m =>
                        typeof m === 'string' ? m : JSON.stringify(m)
                    ),
                })
            );
        },
        /** Answer the oldest parked GET with a body of the test's choosing. */
        deliverRaw(body: unknown): void {
            const answer = parked.shift();
            if (!answer) throw new Error('no parked GET to answer');
            answer(jsonResponse(body));
        },
        planGet(planned: TPlannedGet): void {
            plannedGets.push(planned);
        },
        planPost(planned: TPlannedPost): void {
            plannedPosts.push(planned);
        },
    };
};

type TFetchFake = ReturnType<typeof createFetchFake>;

const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

/** Let a promise chain settle without leaning on real time. */
const drain = async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

describe('CNSDevToolsTransportHttp', () => {
    let transport: CNSDevToolsTransportHttp;
    let fake: TFetchFake;

    const build = (
        overrides: Partial<TCNSDevToolsTransportHttpOptions> = {}
    ): CNSDevToolsTransportHttp => {
        transport = new CNSDevToolsTransportHttp({
            url: BASE_URL,
            fetchImpl: fake.fetch,
            sessionId: SESSION,
            ...overrides,
        });
        return transport;
    };

    beforeEach(() => {
        fake = createFetchFake();
    });

    afterEach(() => transport?.close());

    // ─── Sending ──────────────────────────────────────────────────────────────────

    describe('Sending', () => {
        test('POSTs the batch to the poll endpoint of its session', async () => {
            build();
            await transport.sendBatch(topologyBatch());

            expect(fake.posts).toHaveLength(1);
            expect(fake.posts[0].url).toBe(ENDPOINT);
            const sent = JSON.parse(fake.posts[0].body);
            expect(sent.type).toBe('batch');
            expect(sent.items[0].type).toBe('topology');
        });

        test('sends each batch as its own protocol message', async () => {
            build();
            void transport.sendBatch(topologyBatch());
            await transport.sendBatch(taskBatch());
            await tick();

            expect(fake.posts).toHaveLength(2);
            expect(
                fake.posts.flatMap(p => JSON.parse(p.body).items as unknown[])
            ).toHaveLength(2);
        });

        test('skips the POST when the batch carries no items', async () => {
            build();
            await transport.sendBatch({ type: 'batch', items: [] } as any);
            expect(fake.posts).toHaveLength(0);
        });

        test('keeps the items and does not throw when the POST rejects', async () => {
            build();
            fake.planPost({ error: new Error('server restarting') });

            await expect(
                transport.sendBatch(topologyBatch())
            ).resolves.toBeUndefined();

            // The dropped items ride along with the next send.
            await transport.sendBatch(taskBatch());
            const items = JSON.parse(fake.posts[1].body).items;
            expect(items.map((i: any) => i.type)).toEqual([
                'topology',
                'cns.stimulation.task',
            ]);
        });

        test('treats a non-2xx POST as a failure and requeues', async () => {
            build();
            fake.planPost({ status: 500 });

            await transport.sendBatch(topologyBatch());
            await transport.sendBatch(taskBatch());

            expect(JSON.parse(fake.posts[1].body).items).toHaveLength(2);
        });

        test('logs a failed send when consoleLogEnabled', async () => {
            build({ consoleLogEnabled: true });
            fake.planPost({ error: new Error('server restarting') });

            await transport.sendBatch(topologyBatch());

            expect(console.warn).toHaveBeenCalledWith(
                '[DevTools] Batch send failed:',
                expect.any(Error)
            );
        });

        test('rejects when there is no fetch implementation', async () => {
            const original = (globalThis as any).fetch;
            delete (globalThis as any).fetch;
            try {
                build({ fetchImpl: undefined });
                await expect(transport.sendBatch(taskBatch())).rejects.toThrow(
                    'No fetch implementation'
                );
                // Nothing was started, so nothing has to be torn down.
                expect(fake.gets).toHaveLength(0);
                transport.close();
            } finally {
                (globalThis as any).fetch = original;
            }
        });

        test('falls back to the global fetch', async () => {
            const original = (globalThis as any).fetch;
            (globalThis as any).fetch = fake.fetch;
            try {
                build({ fetchImpl: undefined });
                await transport.sendBatch(topologyBatch());
                expect(fake.posts).toHaveLength(1);
                // Closed while the global is still the fake, so the DELETE lands there.
                transport.close();
                expect(fake.deletes).toEqual([ENDPOINT]);
            } finally {
                (globalThis as any).fetch = original;
            }
        });

        test('mints a session id when none is given', async () => {
            transport = new CNSDevToolsTransportHttp({
                url: `${BASE_URL}/`,
                fetchImpl: fake.fetch,
            });
            await transport.sendBatch(topologyBatch());

            expect(transport.sessionId).toMatch(/^app-/);
            // A trailing slash on the base URL must not double up.
            expect(fake.posts[0].url).toBe(
                `${BASE_URL}/__cnstra/poll?sessionId=${transport.sessionId}`
            );
        });
    });

    // ─── The receive loop ─────────────────────────────────────────────────────────

    describe('Receive loop', () => {
        test('starts on the first send', async () => {
            build();
            expect(fake.gets).toHaveLength(0);
            await transport.sendBatch(topologyBatch());
            await tick();
            expect(fake.gets).toEqual([ENDPOINT]);
        });

        test('starts on the first subscription, without a send', async () => {
            build();
            transport.onStimulationCommand(() => {});
            await tick();
            expect(fake.gets).toHaveLength(1);
        });

        test('starts only once', async () => {
            build();
            transport.onStimulationCommand(() => {});
            await transport.sendBatch(topologyBatch());
            await tick();
            expect(fake.gets).toHaveLength(1);
        });

        test('re-issues a GET as soon as one is answered', async () => {
            build();
            transport.onStimulationCommand(() => {});
            await tick();
            expect(fake.gets).toHaveLength(1);

            fake.deliver(resumeCommand);
            await tick();
            expect(fake.gets).toHaveLength(2);

            fake.deliver();
            await tick();
            expect(fake.gets).toHaveLength(3);
        });

        test('tolerates an answer with no messages field', async () => {
            build();
            transport.onStimulationCommand(() => {});
            await tick();

            fake.deliverRaw({});
            await tick();
            expect(fake.gets).toHaveLength(2);
        });
    });

    // ─── Routing ──────────────────────────────────────────────────────────────────

    describe('Message routing', () => {
        const start = async (): Promise<unknown[]> => {
            const commands: unknown[] = [];
            transport.onStimulationCommand(cmd => commands.push(cmd));
            await tick();
            return commands;
        };

        test('routes cns.stimulation.resume to onStimulationCommand', async () => {
            build();
            const commands = await start();

            fake.deliver(resumeCommand);
            await tick();

            expect(commands).toHaveLength(1);
            expect((commands[0] as any).type).toBe('cns.stimulation.resume');
            expect((commands[0] as any).stimulationId).toBe('s1');
        });

        test('delivers one message to every subscriber', async () => {
            build();
            const seen: string[] = [];
            transport.onStimulationCommand(() => seen.push('a'));
            transport.onStimulationCommand(() => seen.push('b'));
            await tick();

            fake.deliver(resumeCommand);
            await tick();

            expect(seen).toEqual(['a', 'b']);
        });

        test('stops delivering to an unsubscribed command handler', async () => {
            build();
            let count = 0;
            const unsubscribe = transport.onStimulationCommand(() => count++);
            await tick();

            fake.deliver(resumeCommand);
            await tick();
            expect(count).toBe(1);

            unsubscribe();
            fake.deliver(resumeCommand);
            await tick();
            expect(count).toBe(1);
        });

        test('ignores malformed, unknown and invalid messages', async () => {
            build();
            const commands = await start();

            fake.deliver(
                'not-json',
                'null',
                { type: 'apps.result' },
                { type: 'cns.stimulation.launch', bad: 'data' }
            );
            await tick();

            expect(commands).toHaveLength(0);
            // The loop is unharmed by any of it.
            expect(fake.gets).toHaveLength(2);
        });

        test('a throwing handler does not become a poll failure', async () => {
            build({ pollIntervalMs: 1 });
            transport.onStimulationCommand(() => {
                throw new Error('handler blew up');
            });
            await tick();

            fake.deliver(resumeCommand);
            await tick();

            // Straight back to polling — no backoff, no dead loop.
            expect(fake.gets).toHaveLength(2);
        });

        test('warns about invalid messages when consoleLogEnabled', async () => {
            build({ consoleLogEnabled: true });
            await start();

            fake.deliver({ type: 'cns.stimulation.launch', bad: 'data' });
            await tick();

            expect(console.warn).toHaveBeenCalledWith(
                '[DevTools] Invalid stimulation command:',
                expect.any(String)
            );
        });
    });

    // ─── Failure handling ─────────────────────────────────────────────────────────

    describe('Poll failures', () => {
        test('backs off and keeps polling after a rejected request', async () => {
            build({ pollIntervalMs: 1 });
            fake.planGet({ error: new Error('server restarting') });

            const received: unknown[] = [];
            transport.onStimulationCommand(cmd => received.push(cmd));
            await tick(30);

            // The failure did not end the loop: a second GET is parked.
            expect(fake.gets.length).toBeGreaterThan(1);
            fake.deliver(resumeCommand);
            await tick();
            expect(received).toHaveLength(1);
        });

        test('backs off after a non-2xx answer', async () => {
            build({ pollIntervalMs: 1 });
            fake.planGet({ status: 503 });

            transport.onStimulationCommand(() => {});
            await tick(30);

            expect(fake.gets.length).toBeGreaterThan(1);
        });

        test('logs a failed poll when consoleLogEnabled', async () => {
            build({ pollIntervalMs: 1, consoleLogEnabled: true });
            fake.planGet({ error: new Error('server restarting') });

            transport.onStimulationCommand(() => {});
            await tick(30);

            expect(console.warn).toHaveBeenCalledWith(
                '[DevTools] Poll failed, backing off:',
                expect.any(Error)
            );
        });

        test('doubles the delay on consecutive failures', async () => {
            const delays = captureDelays();
            build({ pollIntervalMs: 10 });
            fake.planGet({ error: new Error('down') });
            fake.planGet({ error: new Error('down') });
            fake.planGet({ error: new Error('down') });

            transport.onStimulationCommand(() => {});
            await drain();
            delays.restore();

            expect(delays.values).toEqual([10, 20, 40]);
        });

        test('defaults to a 1000ms backoff', async () => {
            const delays = captureDelays();
            build({});
            fake.planGet({ error: new Error('down') });

            transport.onStimulationCommand(() => {});
            await drain();
            delays.restore();

            expect(delays.values).toEqual([1000]);
        });

        test('caps the backoff at 15s', async () => {
            const delays = captureDelays();
            build({ pollIntervalMs: 60_000 });
            fake.planGet({ error: new Error('down') });

            transport.onStimulationCommand(() => {});
            await drain();
            delays.restore();

            expect(delays.values).toEqual([15_000]);
        });

        test('resets the backoff after a successful poll', async () => {
            const delays = captureDelays();
            build({ pollIntervalMs: 10 });
            fake.planGet({ error: new Error('down') });
            fake.planGet({ body: { messages: [] } });
            fake.planGet({ error: new Error('down') });

            transport.onStimulationCommand(() => {});
            await drain();
            delays.restore();

            expect(delays.values).toEqual([10, 10]);
        });
    });

    // ─── Teardown ─────────────────────────────────────────────────────────────────

    describe('close', () => {
        test('stops the loop and drops the session', async () => {
            build();
            const received: unknown[] = [];
            transport.onStimulationCommand(cmd => received.push(cmd));
            await tick();
            expect(fake.gets).toHaveLength(1);

            transport.close();
            await tick();

            expect(fake.deletes).toEqual([ENDPOINT]);
            // The aborted poll is not retried, and nothing arrives after close.
            expect(fake.gets).toHaveLength(1);
            expect(received).toHaveLength(0);
        });

        test('is idempotent', async () => {
            build();
            await transport.sendBatch(topologyBatch());
            await tick();

            transport.close();
            transport.close();
            await tick();

            expect(fake.deletes).toHaveLength(1);
        });

        test('does not restart the loop after close', async () => {
            build();
            transport.onStimulationCommand(() => {});
            await tick();
            transport.close();
            await tick();

            transport.onStimulationCommand(() => {});
            await tick();
            expect(fake.gets).toHaveLength(1);
        });

        test('survives having no fetch implementation', () => {
            const original = (globalThis as any).fetch;
            delete (globalThis as any).fetch;
            try {
                build({ fetchImpl: undefined });
                expect(() => transport.close()).not.toThrow();
            } finally {
                (globalThis as any).fetch = original;
            }
        });

        test('swallows a rejected DELETE', async () => {
            const failingFetch = jest.fn(() =>
                Promise.reject(new Error('server gone'))
            ) as unknown as typeof fetch;
            build({ fetchImpl: failingFetch });

            expect(() => transport.close()).not.toThrow();
            await tick();
        });
    });
});

/**
 * Runs the transport's backoff sleeps instantly while recording what they asked
 * for — a 15s cap is not something a test should wait out.
 */
const captureDelays = () => {
    const values: number[] = [];
    const spy: any = jest.spyOn(global, 'setTimeout');
    spy.mockImplementation((handler: () => void, ms?: number) => {
        values.push(ms as number);
        handler();
        return 0;
    });

    return {
        values,
        restore: () => spy.mockRestore(),
    };
};
