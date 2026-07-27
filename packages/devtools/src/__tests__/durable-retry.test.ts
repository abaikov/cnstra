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
    CNSDTOAppCommand,
} from '@cnstra/devtools-dto';

// A resumable CNS: importUser (always ok) → persistUser (throws while `shouldFail`).
// Initial run fails at persistUser → frontier = [persistUser]. A retry with the
// fault cleared must resume ONLY persistUser (importUser does NOT re-run) and
// complete — the whole point of frontier resume.

let shouldFail = true;

function buildCNS() {
    const entryCol = collateral<{ id: string }>();
    const importedCol = collateral<{ id: string; name: string }>();

    const importUser = withCtx()
        .neuron({ importedCol })
        .bind(
            { entryCol },
            {
                entryCol: ({ id }, axon) =>
                    axon.importedCol.createSignal({ id, name: 'Neo' }),
            }
        );

    const persistUser = withCtx()
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
 * A loopback of the server: app→server batch items land in a real repo, and the
 * test can push a server→app durable command into the app's command handler.
 */
class LoopbackTransport implements ICNSDevToolsTransport {
    private cmdHandler?: (cmd: CNSDTOAppCommand) => void;
    constructor(private readonly repo: ICNSStimulationRepository) {}

    async sendBatch(message: CNSDTOAppBatchMessage): Promise<void> {
        for (const item of message.items) {
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

    onStimulationCommand(handler: (cmd: CNSDTOAppCommand) => void): () => void {
        this.cmdHandler = handler;
        return () => { this.cmdHandler = undefined; };
    }

    pushCommand(cmd: CNSDTOAppCommand): void {
        this.cmdHandler?.(cmd);
    }
}

describe('Phase 2b-2 — retry resumes the stored frontier over the wire', () => {
    beforeEach(() => { shouldFail = true; });

    it('failed run → server-enriched resume → attempt #2 runs persistUser only, completed', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);

        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        // ── initial run: fails at persistUser ──
        await cns.stimulate(entryCol.createSignal({ id: '42' })).waitUntilComplete().catch(() => {});
        await new Promise(r => setTimeout(r, 50));

        const [stim] = await repo.listStimulations();
        expect(stim.status).toBe('failed');
        expect(stim.progress.tasks.map(t => t.neuronName)).toEqual(['persistUser']);
        expect((await repo.getAttempts(stim.stimulationId)).map(a => a.attemptNumber)).toEqual([1]);

        // ── the server's job: enrich the thin retry from the store, forward a resume ──
        shouldFail = false; // "the fault is fixed"
        const attempts = await repo.getAttempts(stim.stimulationId);
        const nextAttempt = attempts.length + 1;
        transport.pushCommand({
            type: 'cns.stimulation.resume',
            requestId: 'req-1',
            scopeName: stim.scopeName,
            stimulationId: stim.stimulationId,
            stimulationAttemptId: `${stim.stimulationId}#${nextAttempt}`,
            attemptNumber: nextAttempt,
            entry: stim.entry,
            progress: stim.progress,
        });
        await new Promise(r => setTimeout(r, 50));

        // ── the resume landed as attempt #2 of the SAME stimulation ──
        const after = await repo.getStimulation(stim.stimulationId);
        expect(after?.status).toBe('completed');
        expect(after?.progress.tasks).toEqual([]); // frontier drained

        const allAttempts = await repo.getAttempts(stim.stimulationId);
        expect(allAttempts.map(a => a.attemptNumber)).toEqual([1, 2]);
        const a2 = allAttempts.find(a => a.attemptNumber === 2)!;
        expect(a2.status).toBe('completed');
        expect(a2.hasError).toBe(false);

        // attempt #2 ran ONLY persistUser — importUser did NOT re-run
        const tasks2 = await repo.getTasks(a2.stimulationAttemptId);
        expect(tasks2.map(t => t.neuronName)).toEqual(['persistUser']);
        expect(tasks2[0].status).toBe('done');
    });

    it('clone → a fresh stimulation (new id, attempt 1) re-fired from the entry', async () => {
        const { cns, registry, entryCol } = buildCNS();
        const repo = new CNSInMemoryStimulationRepository();
        const transport = new LoopbackTransport(repo);
        const devtools = new CNSDevTools('test-app', transport, {
            cnsId: 'test-cns',
            trackStimulations: true,
        });
        devtools.registerCNS(cns as any, registry);

        // a failed source run to clone from
        await cns.stimulate(entryCol.createSignal({ id: '7' })).waitUntilComplete().catch(() => {});
        await new Promise(r => setTimeout(r, 50));
        const [src] = await repo.listStimulations();

        // server enriches the clone: fresh stimulationId, re-fire from src.entry
        shouldFail = false;
        const newStimulationId = `${src.stimulationId}-clone-1`;
        transport.pushCommand({
            type: 'cns.stimulation.launch',
            requestId: 'req-2',
            scopeName: src.scopeName,
            stimulationId: newStimulationId,
            stimulationAttemptId: `${newStimulationId}#1`,
            entry: src.entry,
        });
        await new Promise(r => setTimeout(r, 50));

        const clone = await repo.getStimulation(newStimulationId);
        expect(clone).toBeDefined();
        expect(clone!.status).toBe('completed');
        expect(clone!.scopeName).toBe('test-cns');
        // a clean full run: BOTH neurons ran, from the entry
        const cloneAttempts = await repo.getAttempts(newStimulationId);
        expect(cloneAttempts.map(a => a.attemptNumber)).toEqual([1]);
        const tasks = await repo.getTasks(cloneAttempts[0].stimulationAttemptId);
        expect(tasks.map(t => t.neuronName)).toEqual(['importUser', 'persistUser']);
        // the source run is untouched (clone is a NEW stimulation)
        expect((await repo.getStimulation(src.stimulationId))?.status).toBe('failed');
    });
});
