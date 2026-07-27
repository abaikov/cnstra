import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { CNS, collateral, withCtx } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSInMemoryStimulationRepository,
} from '@cnstra/persist';
import type { ICNSStimulationRepository } from '@cnstra/persist';
import type {
    CNSDTOAppBatchMessage,
    CNSDTOAppBatchItem,
} from '@cnstra/devtools-dto';

// A real tiny CNS: n1 (neuronOne) fires on `entryCol` → emits `midCol`; n2 (neuronTwo)
// subscribes to `midCol` and always throws. So a single stimulation runs
// entry → neuronOne(done) → neuronTwo(failed), leaving a resumable frontier of [n2].

function buildCNS() {
    const entryCol = collateral<{ n: number }>();
    const midCol = collateral<{ n: number }>();

    const neuronOne = withCtx()
        .neuron({ midCol })
        .bind(
            { entryCol },
            { entryCol: ({ n }, axon) => axon.midCol.createSignal({ n: n + 1 }) }
        );

    const neuronTwo = withCtx()
        .neuron({})
        .bind(
            { midCol },
            {
                midCol: () => {
                    throw new Error('n2 boom');
                },
            }
        );

    const cns = new CNS([neuronOne, neuronTwo]);

    const registry = new CNSPersistOptionsRegistry();
    registry
        .register('neuronOne', neuronOne, { midCol: 'mid-col' })
        .register('neuronTwo', neuronTwo)
        .registerCollateral('entry-col', entryCol);

    return { cns, registry, entryCol };
}

/**
 * Transport that captures every batch item AND forwards the three name-based durable
 * items into a real {@link ICNSStimulationRepository} — the server's job, exercised
 * directly here.
 */
class ForwardingTransport implements ICNSDevToolsTransport {
    items: CNSDTOAppBatchItem[] = [];
    constructor(private readonly repo: ICNSStimulationRepository) {}

    async sendBatch(message: CNSDTOAppBatchMessage): Promise<void> {
        for (const item of message.items) {
            this.items.push(item);
            switch (item.type) {
                case 'cns.stimulation':
                    await this.repo.saveStimulation(item.data);
                    break;
                case 'cns.stimulation.attempt':
                    await this.repo.saveAttempt(item.data);
                    break;
                case 'cns.stimulation.task':
                    await this.repo.appendTask(item.data);
                    break;
            }
        }
    }
}

describe('trackStimulations — name-based run/attempt/task over the wire', () => {
    it('persists a failing stimulation as run → attempt → tasks, legacy path intact', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new ForwardingTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        try {
            await cns
                .stimulate(entryCol.createSignal({ n: 1 }))
                .waitUntilComplete();
        } catch {
            /* the failing neuron may reject waitUntilComplete */
        }
        // Let the persistor's async terminal flush + transport forwarding settle.
        await new Promise(r => setTimeout(r, 50));

        // ── name-based durable model ──
        const stims = await repo.listStimulations();
        expect(stims).toHaveLength(1);
        const stim = stims[0];

        expect(stim.scopeName).toBe('test-cns');
        expect(stim.status).toBe('failed');
        expect(stim.entry.collateralName).toBe('entry-col');
        expect(stim.entry.payload).toEqual({ n: 1 });

        // failed → the outstanding frontier is exactly [neuronTwo]
        expect(stim.progress.tasks.map(t => t.neuronName)).toEqual([
            'neuronTwo',
        ]);
        expect(stim.progress.tasks[0].dendriteCollateralName).toBe('mid-col');

        // ── attempts ──
        const attempts = await repo.getAttempts(stim.stimulationId);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].attemptNumber).toBe(1);
        expect(attempts[0].hasError).toBe(true);
        expect(attempts[0].status).toBe('failed');
        expect(attempts[0].stimulationId).toBe(stim.stimulationId);

        // ── tasks (full-volume history) ──
        const tasks = await repo.getTasks(attempts[0].stimulationAttemptId);
        const byName = new Map(tasks.map(t => [t.neuronName, t]));
        expect([...byName.keys()].sort()).toEqual(['neuronOne', 'neuronTwo']);

        const t1 = byName.get('neuronOne')!;
        expect(t1.status).toBe('done');
        expect(t1.dendriteCollateralName).toBe('entry-col');
        expect(t1.inputIndex).toBe(0); // reads the entry slot
        expect(t1.output).toEqual({
            collateralName: 'mid-col',
            payload: { n: 2 },
        });

        const t2 = byName.get('neuronTwo')!;
        expect(t2.status).toBe('failed');
        expect(t2.dendriteCollateralName).toBe('mid-col');
        expect(t2.inputIndex).toBe(t1.index); // reads neuronOne's output slot
        expect(t2.error).toContain('n2 boom');

        // ── the name-based batch items are the ONLY stimulation emit (2b-4) ──
        expect(transport.items.some(i => i.type === 'cns.stimulation')).toBe(true);
        expect(
            transport.items.some(i => i.type === 'cns.stimulation.attempt')
        ).toBe(true);
        expect(transport.items.some(i => i.type === 'cns.stimulation.task')).toBe(
            true
        );
        // The legacy id-based item types no longer exist in the batch union at all
        // (removed in 2b-4) — the name-based items above are the only emit path.
        const types = new Set(transport.items.map(i => i.type));
        expect([...types].every(t => t.startsWith('cns.') || t === 'topology')).toBe(
            true
        );
    });
});
