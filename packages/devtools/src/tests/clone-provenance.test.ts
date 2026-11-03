import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { CNS, cnsCollateral, cnsNeuronFactory } from '@cnstra/core';
import {
    CNSInMemoryStimulationRepository,
    CNSPersistOptionsRegistry,
} from '@cnstra/persist';
import type {
    TCNSAppBatchMessageDTO,
    TCNSAppCommandDTO,
} from '@cnstra/devtools-dto';

/**
 * Clone: a fresh run (NEW stimulationId, attempt 1) re-fired from the source
 * entry. Unlike a retry it shares nothing with the original — which is exactly
 * why the attempt it was forked from has to be recorded, or the clone is an
 * orphan row in the panel and an unrelated tree in the traces.
 */

let calls: string[] = [];

function buildCNS() {
    const entryCol = cnsCollateral<{ id: string }>();
    const importedCol = cnsCollateral<{ id: string }>();

    const importUser = cnsNeuronFactory()
        .neuron({ importedCol })
        .bind(
            { entryCol },
            {
                entryCol: ({ id }, axon) => {
                    calls.push('importUser');
                    return axon.importedCol.createSignal({ id });
                },
            }
        );

    const persistUser = cnsNeuronFactory()
        .neuron({})
        .bind(
            { importedCol },
            {
                importedCol: () => {
                    calls.push('persistUser');
                    return undefined;
                },
            }
        );

    const cns = new CNS([importUser, persistUser]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('importUser', importUser as never);
    registry.register('persistUser', persistUser as never);
    registry.registerCollateral('entryCol', entryCol);

    return { cns, registry, entryCol };
}

/** Feeds every batch item into a store and lets a test push commands back. */
class LoopbackTransport implements ICNSDevToolsTransport {
    private cmdHandler?: (cmd: TCNSAppCommandDTO) => void;

    constructor(private readonly repo: CNSInMemoryStimulationRepository) {}

    async sendBatch(message: TCNSAppBatchMessageDTO): Promise<void> {
        for (const item of message.items ?? []) {
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
}

describe('a resumed attempt records what its tasks actually ran on', () => {
    it('carries the frontier as the attempt entry, not the run original signal', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ id: '42' }))
            .waitUntilComplete()
            .catch(() => {});
        await new Promise(r => setTimeout(r, 50));

        const [source] = await repo.listStimulations();

        // A frontier whose task runs on `importedCol`, NOT on the run's entry.
        transport.pushCommand({
            type: 'cns.stimulation.resume',
            requestId: 'req-1',
            scopeName: source.scopeName,
            stimulationId: source.stimulationId,
            stimulationAttemptId: `${source.stimulationId}#2`,
            attemptNumber: 2,
            entry: source.entry,
            progress: {
                tasks: [
                    {
                        neuronName: 'persistUser',
                        dendriteCollateralName: 'importUser.importedCol',
                        input: { collateralName: 'importUser.importedCol', payload: { id: '42' } },
                    },
                ],
            },
        } as TCNSAppCommandDTO);
        await new Promise(r => setTimeout(r, 50));

        const attempts = await repo.getAttempts(source.stimulationId);
        const resumed = attempts.find(a => a.attemptNumber === 2);

        expect(resumed).toBeDefined();
        // The signal the resumed task actually consumed — not `entryCol`.
        expect(resumed!.entry.map(e => e.collateralName)).toEqual(['importUser.importedCol']);
    });
});

describe('clone', () => {
    beforeEach(() => {
        calls = [];
    });

    it('re-runs the WHOLE flow from the entry, unlike a retry', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ id: '42' }))
            .waitUntilComplete()
            .catch(() => {});
        await new Promise(r => setTimeout(r, 50));

        const [source] = await repo.listStimulations();
        calls = [];

        transport.pushCommand({
            type: 'cns.stimulation.launch',
            requestId: 'req-1',
            scopeName: source.scopeName,
            stimulationId: `${source.stimulationId}-clone-1-a`,
            stimulationAttemptId: `${source.stimulationId}-clone-1-a#1`,
            entry: source.entry,
        } as TCNSAppCommandDTO);
        await new Promise(r => setTimeout(r, 50));

        // A retry would resume only the outstanding frontier; a clone starts over.
        expect(calls).toEqual(['importUser', 'persistUser']);
    });

    it('records the attempt it was forked from, so the clone is not an orphan', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ id: '42' }))
            .waitUntilComplete()
            .catch(() => {});
        await new Promise(r => setTimeout(r, 50));

        const [source] = await repo.listStimulations();
        const sourceAttempt = (await repo.getAttempts(source.stimulationId))[0];
        const cloneId = `${source.stimulationId}-clone-1-a`;

        transport.pushCommand({
            type: 'cns.stimulation.launch',
            requestId: 'req-1',
            scopeName: source.scopeName,
            stimulationId: cloneId,
            stimulationAttemptId: `${cloneId}#1`,
            entry: source.entry,
            replayOf: sourceAttempt.stimulationAttemptId,
        } as TCNSAppCommandDTO);
        await new Promise(r => setTimeout(r, 50));

        const [attempt] = await repo.getAttempts(cloneId);
        expect(attempt).toBeDefined();
        expect(attempt.replayOf).toBe(sourceAttempt.stimulationAttemptId);
    });

    it('leaves the source run untouched — that is why you clone instead of retrying', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ id: '42' }))
            .waitUntilComplete()
            .catch(() => {});
        await new Promise(r => setTimeout(r, 50));

        const [source] = await repo.listStimulations();
        const before = await repo.getAttempts(source.stimulationId);
        const cloneId = `${source.stimulationId}-clone-1-a`;

        transport.pushCommand({
            type: 'cns.stimulation.launch',
            requestId: 'req-1',
            scopeName: source.scopeName,
            stimulationId: cloneId,
            stimulationAttemptId: `${cloneId}#1`,
            entry: source.entry,
        } as TCNSAppCommandDTO);
        await new Promise(r => setTimeout(r, 50));

        const after = await repo.getAttempts(source.stimulationId);
        expect(after).toHaveLength(before.length);
        expect(await repo.getAttempts(cloneId)).toHaveLength(1);
    });

    it('ignores a clone whose entry collateral is not registered', async () => {
        const { cns, registry } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        transport.pushCommand({
            type: 'cns.stimulation.launch',
            requestId: 'req-1',
            stimulationId: 'ghost',
            stimulationAttemptId: 'ghost#1',
            entry: { collateralName: 'not-registered', payload: null },
        } as TCNSAppCommandDTO);
        await new Promise(r => setTimeout(r, 30));

        // Nothing ran, and the host app did not crash.
        expect(calls).toEqual([]);
        expect(await repo.listStimulations()).toHaveLength(0);
    });
});
