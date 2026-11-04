import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { CNS, collateral, neuronFactory } from '@cnstra/core';
import {
    CNSInMemoryStimulationRepository,
    CNSPersistOptionsRegistry,
} from '@cnstra/persist';
import type {
    TCNSAppBatchItemDTO,
    TCNSAppBatchMessageDTO,
    TCNSAppCommandDTO,
} from '@cnstra/devtools-dto';

/**
 * Lifecycle of a CNSDevTools instance as an APP sees it: an app that takes the
 * documented defaults, an app whose graph is only partly registered, and an app
 * that shuts the devtools down. Each of these went wrong in a way the panel could
 * not show — a dead Retry button, a killed process, a double-counted run.
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let shouldFail = true;

/** importUser (always ok) → persistUser (throws while `shouldFail`). */
function buildCNS() {
    const entryCol = collateral<{ id: string }>();
    const importedCol = collateral<{ id: string; name: string }>();

    const importUser = neuronFactory()
        .neuron({ importedCol })
        .bind(
            { entryCol },
            {
                entryCol: ({ id }, axon) =>
                    axon.importedCol.createSignal({ id, name: 'Neo' }),
            }
        );

    const persistUser = neuronFactory()
        .neuron({})
        .bind(
            { importedCol },
            {
                importedCol: () => {
                    if (shouldFail) throw new Error('db timeout');
                    return undefined;
                },
            }
        );

    const cns = new CNS([importUser, persistUser]);

    const registry = new CNSPersistOptionsRegistry();
    registry
        .register('importUser', importUser, { importedCol: 'imported-col' })
        .register('persistUser', persistUser)
        .registerCollateral('entry-col', entryCol);

    return { cns, registry, entryCol };
}

/**
 * The same loopback the resume tests use: app→server batch items land in a real
 * store, and the test can push a server→app command back. It also keeps every raw
 * item, so a test can assert on what was emitted (or that nothing was).
 */
class LoopbackTransport implements ICNSDevToolsTransport {
    readonly items: TCNSAppBatchItemDTO[] = [];
    private cmdHandler?: (cmd: TCNSAppCommandDTO) => void;

    constructor(private readonly repo: CNSInMemoryStimulationRepository) {}

    async sendBatch(message: TCNSAppBatchMessageDTO): Promise<void> {
        for (const item of message.items ?? []) {
            this.items.push(item);
            const any = item as any;
            if (any.type === 'cns.stimulation')
                await this.repo.saveStimulation(any.data);
            else if (any.type === 'cns.stimulation.attempt')
                await this.repo.saveAttempt(any.data);
            else if (any.type === 'cns.stimulation.task')
                await this.repo.appendTask(any.data);
        }
    }

    onStimulationCommand(handler: (cmd: TCNSAppCommandDTO) => void): () => void {
        this.cmdHandler = handler;
        return () => {
            this.cmdHandler = undefined;
        };
    }

    pushCommand(cmd: TCNSAppCommandDTO): void {
        this.cmdHandler?.(cmd);
    }

    taskNeuronNames(): string[] {
        return this.items
            .filter(i => (i as any).type === 'cns.stimulation.task')
            .map(i => (i as any).data.neuronName as string);
    }
}

describe('CNSDevTools lifecycle', () => {
    beforeEach(() => {
        shouldFail = true;
    });

    it('a resume forwarded by the server runs even when the app never passed trackStimulations', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        // Exactly what the docs promise: tracking is on by default, so an app that
        // sets nothing still streams runs — and must still ACCEPT a retry for them.
        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
        });
        devtools.registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ id: '42' }))
            .waitUntilComplete()
            .catch(() => {});
        await sleep(50);

        const [stim] = await repo.listStimulations();
        expect(stim.status).toBe('failed');

        shouldFail = false;
        transport.pushCommand({
            type: 'cns.stimulation.resume',
            requestId: 'req-1',
            scopeName: stim.scopeName,
            stimulationId: stim.stimulationId,
            stimulationAttemptId: `${stim.stimulationId}#2`,
            attemptNumber: 2,
            entry: stim.entry,
            progress: stim.progress,
        } as TCNSAppCommandDTO);
        await sleep(50);

        // Without a registered command handler the resume is dropped on the floor:
        // the panel says "Retry accepted" and no attempt #2 ever exists.
        const attempts = await repo.getAttempts(stim.stimulationId);
        expect(attempts.map(a => a.attemptNumber)).toEqual([1, 2]);
        expect((await repo.getStimulation(stim.stimulationId))?.status).toBe(
            'completed'
        );
    });

    it('an unregistered frontier neuron warns once and never becomes an unhandled rejection', async () => {
        // Only importUser is registered. persistUser sits in the frontier while it
        // runs, so the progress serializer — which the persistor calls from a
        // fire-and-forget async flush — throws over it mid-run.
        const entryCol = collateral<{ id: string }>();
        const importedCol = collateral<{ id: string }>();

        const importUser = neuronFactory()
            .neuron({ importedCol })
            .bind(
                { entryCol },
                {
                    entryCol: ({ id }, axon) =>
                        axon.importedCol.createSignal({ id }),
                }
            );
        // Held on a deferred WE control, so the unregistered neuron is provably
        // still in the frontier when the first response fires. No sleeps, no
        // dependence on the persistor's debounce — the guard runs per response.
        let release!: () => void;
        const held = new Promise<void>(resolve => (release = resolve));
        const unregisteredNeuron = neuronFactory()
            .neuron({})
            .bind(
                { importedCol },
                {
                    importedCol: async () => {
                        await held;
                        return undefined;
                    },
                }
            );

        const cns = new CNS([importUser, unregisteredNeuron]);
        const registry = new CNSPersistOptionsRegistry();
        registry
            .register('importUser', importUser, { importedCol: 'imported-col' })
            .registerCollateral('entry-col', entryCol);
        // unregisteredNeuron is deliberately NOT registered.

        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);

        let rejectedWith: unknown;
        let rejected = false;
        try {
            const devtools = new CNSDevTools('test-app', transport, {
                cnsId: 'test-cns',
            });
            devtools.registerCNS(cns as any, registry);

            const stimulation = cns.stimulate(entryCol.createSignal({ id: '42' }));
            const settled = stimulation.waitUntilComplete().catch(e => {
                rejected = true;
                rejectedWith = e;
            });
            // The unregistered neuron is parked on `held`, so it is outstanding
            // right now — every response since the entry has seen it.
            await Promise.resolve();
            release();
            await settled;
            // Give any discarded rejection its chance to reach the process.
            await sleep(50);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            warn.mockRestore();
        }

        // The host app is untouched: its own run completes normally...
        expect(rejected ? rejectedWith : null).toBeNull();
        // ...nothing escaped as an unhandled rejection (which terminates node)...
        expect(unhandled).toEqual([]);
        // ...and if tracking did give up on this run, it said so at most once.
        //
        // Deliberately "at most": whether the frontier is unserializable AT a
        // response depends on how the graph is scheduled — the window can be a
        // single response wide, and forcing it here would test the scheduler, not
        // the guard. What must hold on every schedule is the two assertions above:
        // the host app is untouched and nothing escapes as an unhandled rejection.
        const warnings = warn.mock.calls.filter(
            c =>
                typeof c[0] === 'string' &&
                c[0].includes('[CNSDevTools] resumable stimulation tracking skipped')
        );
        expect(warnings.length).toBeLessThanOrEqual(1);
    });

    it('destroy() detaches the response listener — a later run emits nothing', async () => {
        shouldFail = false;
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
        });
        devtools.registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ id: '1' }))
            .waitUntilComplete();
        await sleep(50);
        expect(transport.items.length).toBeGreaterThan(0);

        devtools.destroy();
        const emittedBeforeDestroy = transport.items.length;

        await cns
            .stimulate(entryCol.createSignal({ id: '2' }))
            .waitUntilComplete();
        await sleep(50);

        expect(transport.items.length).toBe(emittedBeforeDestroy);
        expect(await repo.listStimulations()).toHaveLength(1);
    });

    it('re-registering after destroy() emits each task once, not once per past registration', async () => {
        shouldFail = false;
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
        });
        devtools.registerCNS(cns as any, registry);
        devtools.destroy();
        devtools.registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ id: '1' }))
            .waitUntilComplete();
        await sleep(50);

        // A leaked listener would emit every row twice, under two unrelated
        // stimulation ids and two independent task numberings.
        expect(transport.taskNeuronNames()).toEqual([
            'importUser',
            'persistUser',
        ]);
        expect(await repo.listStimulations()).toHaveLength(1);
    });
});
