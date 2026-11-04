import { CNS, collateral, neuron } from '@cnstra/core';
import {
    CNSPersistOptionsRegistry,
    CNSInMemoryStimulationRepository,
} from '@cnstra/persist';
import { runCNSStimulationJob, createCNSDrainState } from '@cnstra/broker';
import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { ANY_STIMULATION, readSync } from './readSync';

/**
 * The bull / pg-boss → Explorer connection.
 *
 * Both `@cnstra/pg-boss` and `@cnstra/bullmq` run each job through the SAME
 * `runCNSStimulationJob` core, writing the canonical name-based
 * Stimulation → Attempt → Task history to their `observe: ICNSStimulationRepository`.
 * `startCNSDevTools({ stimulationRepository })` hands that very instance to
 * `CNSDevToolsServer`. So a single shared store means every job run a worker
 * processes is immediately queryable through the Explorer's list/facets/detail —
 * no extra wiring, no second copy of the data. This test drives real jobs through
 * the core and asserts they surface through the Explorer protocol.
 */

// Two "job types" (entry collaterals), like two of pg-boss's ~20 queues.
// importDoc → parse; sendEmail → deliver (which fails when the payload says so).
function buildFlow() {
    const importDoc = collateral<{ docId: number }>();
    const parsed = collateral<{ docId: number }>();
    const sendEmail = collateral<{ to: string; boom?: boolean }>();
    const delivered = collateral<{ to: string }>();

    const parser = neuron({ parsed }).dendrite({
        collateral: importDoc,
        response: (p, axon) => axon.parsed.createSignal({ docId: p!.docId }),
    });
    const mailer = neuron({ delivered }).dendrite({
        collateral: sendEmail,
        response: (p, axon) => {
            if (p!.boom) throw new Error('smtp down');
            return axon.delivered.createSignal({ to: p!.to });
        },
    });

    const cns = new CNS([parser, mailer]);

    const registry = new CNSPersistOptionsRegistry();
    registry.register('parser', parser);
    registry.register('mailer', mailer);
    registry.registerCollateral('importDoc', importDoc);
    registry.registerCollateral('sendEmail', sendEmail);

    return { cns, registry };
}

async function runJob(
    cns: any,
    registry: CNSPersistOptionsRegistry,
    store: CNSInMemoryStimulationRepository,
    jobId: string,
    collateralName: string,
    payload: unknown
): Promise<void> {
    const drain = createCNSDrainState();
    try {
        await runCNSStimulationJob({
            pkgName: '@cnstra/pg-boss',
            stopping: false,
            cns,
            registry,
            jobId,
            collateralName,
            payload,
            attemptNumber: 1,
            observe: store, // ← the SAME store the DevTools server reads from
            abort: drain.abort,
            active: drain.active,
        });
    } catch {
        // a failing job (mailer boom) still records its stimulation/attempt/tasks
    }
}

describe('bull/pg-boss worker → shared observe store → Explorer', () => {
    let store: CNSInMemoryStimulationRepository;
    let server: CNSDevToolsServer;

    beforeEach(async () => {
        store = new CNSInMemoryStimulationRepository();
        server = new CNSDevToolsServer(
            new CNSDevToolsServerRepositoryInMemory(),
            store // exactly what startCNSDevTools({ stimulationRepository }) injects
        );
        const { cns, registry } = buildFlow();
        // 2× importDoc (ok), 1× sendEmail ok, 1× sendEmail that fails
        await runJob(cns, registry, store, 'job-1', 'importDoc', { docId: 1 });
        await runJob(cns, registry, store, 'job-2', 'importDoc', { docId: 2 });
        await runJob(cns, registry, store, 'job-3', 'sendEmail', { to: 'a@x' });
        await runJob(cns, registry, store, 'job-4', 'sendEmail', {
            to: 'b@x',
            boom: true,
        });
    });

    it('a page shows every job run the worker observed', async () => {
        const page = await readSync(server, 'stimulationPage', [...ANY_STIMULATION, undefined, undefined, 50]);
        expect(page.total).toBe(4);
        expect(page.rows.map(row => row.stimulationId).sort()).toEqual(['job-1', 'job-2', 'job-3', 'job-4']);
        const j4 = page.rows.find(row => row.stimulationId === 'job-4')!;
        expect(j4.entry.collateralName).toBe('sendEmail');
        expect(j4.hasError).toBe(true);
    });

    it('facets group by job type (entry collateral) and status', async () => {
        const facets = await readSync(server, 'stimulationFacets', [...ANY_STIMULATION, undefined]);
        expect(facets.byEntryCollateral.find(bucket => bucket.name === 'importDoc')!.count).toBe(2);
        expect(facets.byEntryCollateral.find(bucket => bucket.name === 'sendEmail')!.count).toBe(2);
        expect(facets.byNeuron.find(bucket => bucket.name === 'parser')!.count).toBe(2);
    });

    it('detail returns the run’s attempt + task waterfall for a job', async () => {
        const detail = await readSync(server, 'stimulationDetail', ['job-1']);
        expect(detail.attempts.map(attempt => attempt.stimulationId)).toEqual(['job-1']);
        expect(detail.tasks.map(task => task.neuronName)).toContain('parser');
    });
});
