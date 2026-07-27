// Full chain: producer (@cnstra/devtools, trackStimulations) → wire batch →
// CNSDevToolsServer.handleMessage → injected CNSInMemoryStimulationRepository.
import { CNS, collateral, withCtx } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSInMemoryStimulationRepository,
} from '@cnstra/persist';
import { CNSDevTools } from '@cnstra/devtools';
import type { ICNSDevToolsTransport } from '@cnstra/devtools';
import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';

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

describe('CNSDevToolsServer — name-based durable items → stimulationRepository', () => {
    it('routes producer cns.stimulation(.attempt|.task) into the injected repo', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const stimRepo = new CNSInMemoryStimulationRepository();
        const server = new CNSDevToolsServer(
            new CNSDevToolsServerRepositoryInMemory(),
            stimRepo
        );
        const fakeWs: any = { readyState: 1, send: () => {} };

        const transport: ICNSDevToolsTransport = {
            sendBatch: (message: any) => server.handleMessage(fakeWs, message),
        };

        const devtools = new CNSDevTools('e2e-app', transport, {
            cnsId: 'e2e-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        try {
            await cns
                .stimulate(entryCol.createSignal({ n: 1 }))
                .waitUntilComplete();
        } catch {
            /* failing neuron */
        }
        await new Promise(r => setTimeout(r, 80));

        const repo = server.getStimulationRepository();
        const stims = await repo.listStimulations();
        expect(stims).toHaveLength(1);
        expect(stims[0].scopeName).toBe('e2e-cns');
        expect(stims[0].status).toBe('failed');
        expect(stims[0].entry.collateralName).toBe('entry-col');
        expect(stims[0].progress.tasks.map(t => t.neuronName)).toEqual([
            'neuronTwo',
        ]);

        const attempts = await repo.getAttempts(stims[0].stimulationId);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].attemptNumber).toBe(1);

        const tasks = await repo.getTasks(attempts[0].stimulationAttemptId);
        expect(tasks.map(t => t.neuronName).sort()).toEqual([
            'neuronOne',
            'neuronTwo',
        ]);
    });
});
