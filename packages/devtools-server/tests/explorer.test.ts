import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';
import { ANY_STIMULATION as ALL, readSync as read, transduceSync as transduce } from './readSync';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

const stim = (
    id: string,
    entryCollateral: string,
    status: 'running' | 'completed' | 'failed'
): TCNSStimulationState => ({
    stimulationId: id,
    entry: { collateralName: entryCollateral, payload: { n: 1 } },
    status: status as TCNSStimulationState['status'],
    progress: { tasks: [] },
    scopeName: 'app:main',
});
const attempt = (
    id: string,
    startedAt: number,
    status: 'running' | 'completed' | 'failed'
): TCNSStimulationAttempt => ({
    stimulationAttemptId: `${id}#1`,
    stimulationId: id,
    attemptNumber: 1,
    status: status as TCNSStimulationAttempt['status'],
    startedAt,
    completedAt: status === 'running' ? null : startedAt + 100,
    hopCount: 2,
    hasError: status === 'failed',
    replayOf: null,
    entry: [{ collateralName: 'e', payload: {} }],
});
const task = (id: string, neuron: string): TCNSStimulationTask => ({
    stimulationAttemptId: `${id}#1`,
    index: 0,
    neuronName: neuron,
    dendriteCollateralName: 'in',
    inputIndex: 0,
    output: { collateralName: 'out', payload: {} },
    status: 'done' as TCNSStimulationTask['status'],
    error: null,
    startedAt: 1000,
    duration: 5,
});

async function seed(repo: CNSInMemoryStimulationRepository) {
    // 2× import-doc (1 completed, 1 failed) + 1× send-email (completed)
    for (const [id, col, st, t] of [
        ['s1', 'import-doc', 'completed', 1000],
        ['s2', 'import-doc', 'failed', 2000],
        ['s3', 'send-email', 'completed', 3000],
    ] as const) {
        await repo.saveStimulation(stim(id, col, st));
        await repo.saveAttempt(attempt(id, t, st));
        await repo.appendTask(task(id, 'neuronA'));
    }
}

describe('sync reads', () => {
    let repo: CNSInMemoryStimulationRepository;
    let server: CNSDevToolsServer;
    beforeEach(async () => {
        repo = new CNSInMemoryStimulationRepository();
        server = new CNSDevToolsServer(
            new CNSDevToolsServerRepositoryInMemory(),
            repo
        );
        await seed(repo);
    });

    it('a page is the roster rows newest first, with summaries', async () => {
        const page = await read(server, 'stimulationPage', [...ALL, undefined, undefined, 50]);
        expect(page.total).toBe(3);
        expect(page.rows.map(row => row.stimulationId)).toEqual(['s3', 's2', 's1']);
        const s2 = page.rows.find(row => row.stimulationId === 's2')!;
        expect(s2.entry.collateralName).toBe('import-doc');
        expect(s2.hasError).toBe(true);
        expect(s2.startedAt).toBe(2000);
        expect(s2.hopCount).toBe(2);
    });

    it('a head page keeps the runs at or newer than its boundary, so the pages behind the boundary stay where they are', async () => {
        const first = await read(server, 'stimulationPage', [...ALL, undefined, undefined, 2]);
        const head = await read(server, 'stimulationPage', [...ALL, first.nextCursor!, undefined, 10]);
        expect(head.rows.map(row => row.stimulationId)).toEqual(['s3', 's2']);
        const tail = await read(server, 'stimulationPage', [...ALL, undefined, first.nextCursor!, 10]);
        expect(tail.rows.map(row => row.stimulationId)).toEqual(['s1']);
    });

    it('a page key filters by status and entry collateral', async () => {
        const page = await read(server, 'stimulationPage', [undefined, 'completed', 'import-doc', undefined, undefined, undefined, undefined, undefined, undefined, 50]);
        expect(page.rows.map(row => row.stimulationId)).toEqual(['s1']);
    });

    it('the next page is the key with the cursor of the page before it', async () => {
        const first = await read(server, 'stimulationPage', [...ALL, undefined, undefined, 2]);
        expect(first.rows.map(row => row.stimulationId)).toEqual(['s3', 's2']);
        expect(first.nextCursor).toBeTruthy();
        const second = await read(server, 'stimulationPage', [...ALL, undefined, first.nextCursor!, 2]);
        expect(second.rows.map(row => row.stimulationId)).toEqual(['s1']);
        expect(second.nextCursor).toBeFalsy();
    });

    it('facets count by entry collateral and status', async () => {
        const facets = await read(server, 'stimulationFacets', [...ALL, undefined]);
        expect(facets.byEntryCollateral.find(bucket => bucket.name === 'import-doc')!.count).toBe(2);
        expect(facets.byEntryCollateral.find(bucket => bucket.name === 'send-email')!.count).toBe(1);
        expect(facets.byStatus.find(bucket => bucket.status === 'completed')!.count).toBe(2);
        expect(facets.byStatus.find(bucket => bucket.status === 'failed')!.count).toBe(1);
    });

    it('facets carry a byTime histogram, and the metric path in the key sums an entry payload field', async () => {
        const plain = await read(server, 'stimulationFacets', [...ALL, undefined]);
        expect(plain.byTime.reduce((runs, bucket) => runs + bucket.completed + bucket.failed + bucket.running, 0)).toBe(3);
        expect(plain.byTime.every(bucket => bucket.metric === undefined)).toBe(true);
        const summed = await read(server, 'stimulationFacets', [...ALL, 'n']);
        expect(summed.byTime.reduce((sum, bucket) => sum + (bucket.metric ?? 0), 0)).toBe(3);
    });

    it('facets count activations per neuron, and a page key filters by neuron', async () => {
        const facets = await read(server, 'stimulationFacets', [...ALL, undefined]);
        expect(facets.byNeuron.find(bucket => bucket.name === 'neuronA')!.count).toBe(3);
        const activated = await read(server, 'stimulationPage', [undefined, undefined, undefined, 'neuronA', undefined, undefined, undefined, undefined, undefined, 50]);
        expect(activated.rows).toHaveLength(3);
        const none = await read(server, 'stimulationPage', [undefined, undefined, undefined, 'nonexistent', undefined, undefined, undefined, undefined, undefined, 50]);
        expect(none.rows).toHaveLength(0);
    });

    it('a detail key answers the attempts and tasks of its run only', async () => {
        const detail = await read(server, 'stimulationDetail', ['s2']);
        expect(detail.attempts.map(attempt => attempt.stimulationId)).toEqual(['s2']);
        expect(detail.tasks.map(task => task.stimulationAttemptId)).toEqual(['s2#1']);
    });

    it('detail keys of one request are read in one pass over the store', async () => {
        const getAttemptsFor = jest.spyOn(repo, 'getAttemptsFor');
        const rows = await transduce(server, ['s1', 's2', 's3'].map(id => ({ name: 'stimulationDetail', key: [id] })));
        expect(getAttemptsFor).toHaveBeenCalledTimes(1);
        expect(rows.map(row => ('data' in row ? (row.data as TCNSDevToolsSyncData['stimulationDetail']).attempts.map(attempt => attempt.stimulationId) : row))).toEqual([['s1'], ['s2'], ['s3']]);
    });

    it('a snapshot key answers roster rows only', async () => {
        const { stimulations } = await read(server, 'stimulationSnapshot', [...ALL, 2]);
        expect(stimulations.map(row => row.stimulationId)).toEqual(['s3', 's2']);
    });

    it('a malformed key fails alone and the rest of the request is answered', async () => {
        const rows = await transduce(server, [
            { name: 'stimulationPage', key: ['too', 'short'] },
            { name: 'stimulationDetail', key: [42] },
            { name: 'stimulationSnapshot', key: [...ALL, 1] },
            { name: 'nope', key: [] },
        ]);
        expect(rows.map(row => ('error' in row ? 'error' : 'data'))).toEqual(['error', 'error', 'data', 'error']);
    });

    it('a server with no scheduled reader answers an empty unavailable page', async () => {
        expect(await read(server, 'scheduledPage', [undefined, undefined, undefined, 50])).toEqual({ available: false, rows: [], schedules: [], types: [], nextCursor: null });
    });
});
