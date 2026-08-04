import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

function makeWs() {
    const sent: string[] = [];
    return {
        readyState: 1,
        sent,
        send: (data: string) => sent.push(data),
        reply: (type: string) =>
            sent.map(s => JSON.parse(s)).find(m => m.type === type),
    };
}

const stim = (
    id: string,
    entryCollateral: string,
    status: 'running' | 'completed' | 'failed'
): TCNSStimulationState => ({
    stimulationId: id,
    entry: { collateralName: entryCollateral, payload: { n: 1 } },
    status: status as TCNSStimulationState['status'],
    progress: { tasks: [], context: {} },
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

describe('explorer bucket protocol', () => {
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

    it('list returns a flat stimulations bucket, newest-first, with summaries', async () => {
        const ws = makeWs();
        await server.handleMessage(
            ws as any,
            JSON.stringify({ type: 'cns.stimulations.list', requestId: 'r' })
        );
        const res = ws.reply('cns.stimulations.list.result');
        expect(res.total).toBe(3);
        expect(res.stimulations.map((s: any) => s.stimulationId)).toEqual([
            's3',
            's2',
            's1',
        ]); // newest startedAt first
        const s2 = res.stimulations.find((s: any) => s.stimulationId === 's2');
        expect(s2.entry.collateralName).toBe('import-doc');
        expect(s2.hasError).toBe(true);
        expect(s2.startedAt).toBe(2000);
        expect(s2.hopCount).toBe(2);
    });

    it('list filters by status + entryCollateralName', async () => {
        const ws = makeWs();
        await server.handleMessage(
            ws as any,
            JSON.stringify({
                type: 'cns.stimulations.list',
                requestId: 'r',
                filter: { status: 'completed', entryCollateralName: 'import-doc' },
            })
        );
        const res = ws.reply('cns.stimulations.list.result');
        expect(res.stimulations.map((s: any) => s.stimulationId)).toEqual(['s1']);
    });

    it('list paginates by keyset cursor', async () => {
        const p1 = makeWs();
        await server.handleMessage(
            p1 as any,
            JSON.stringify({ type: 'cns.stimulations.list', requestId: 'r', limit: 2 })
        );
        const r1 = p1.reply('cns.stimulations.list.result');
        expect(r1.stimulations.map((s: any) => s.stimulationId)).toEqual(['s3', 's2']);
        expect(r1.nextCursor).toBeTruthy();

        const p2 = makeWs();
        await server.handleMessage(
            p2 as any,
            JSON.stringify({
                type: 'cns.stimulations.list',
                requestId: 'r',
                limit: 2,
                cursor: r1.nextCursor,
            })
        );
        const r2 = p2.reply('cns.stimulations.list.result');
        expect(r2.stimulations.map((s: any) => s.stimulationId)).toEqual(['s1']);
        expect(r2.nextCursor).toBeFalsy();
    });

    it('facets counts by entry collateral + status', async () => {
        const ws = makeWs();
        await server.handleMessage(
            ws as any,
            JSON.stringify({ type: 'cns.stimulations.facets', requestId: 'r' })
        );
        const { facets } = ws.reply('cns.stimulations.facets.result');
        expect(
            facets.byEntryCollateral.find((f: any) => f.name === 'import-doc').count
        ).toBe(2);
        expect(
            facets.byEntryCollateral.find((f: any) => f.name === 'send-email').count
        ).toBe(1);
        expect(facets.byStatus.find((f: any) => f.status === 'completed').count).toBe(2);
        expect(facets.byStatus.find((f: any) => f.status === 'failed').count).toBe(1);
    });

    it('facets include a byTime histogram; metricPath sums an entry-payload field', async () => {
        const noMetric = makeWs();
        await server.handleMessage(
            noMetric as any,
            JSON.stringify({ type: 'cns.stimulations.facets', requestId: 'r' })
        );
        const f1 = noMetric.reply('cns.stimulations.facets.result').facets;
        const totalRuns = f1.byTime.reduce(
            (n: number, b: any) => n + b.completed + b.failed + b.running,
            0
        );
        expect(totalRuns).toBe(3); // every run lands in some bucket
        expect(f1.byTime.every((b: any) => b.metric === undefined)).toBe(true);

        const withMetric = makeWs();
        await server.handleMessage(
            withMetric as any,
            JSON.stringify({
                type: 'cns.stimulations.facets',
                requestId: 'r',
                metricPath: 'n', // seed payloads are { n: 1 }
            })
        );
        const f2 = withMetric.reply('cns.stimulations.facets.result').facets;
        const metricSum = f2.byTime.reduce(
            (n: number, b: any) => n + (b.metric ?? 0),
            0
        );
        expect(metricSum).toBe(3); // 3 runs × n=1
    });

    it('facets include byNeuron; list filters by neuronName (neurons lens)', async () => {
        const ws = makeWs();
        await server.handleMessage(
            ws as any,
            JSON.stringify({ type: 'cns.stimulations.facets', requestId: 'r' })
        );
        const { facets } = ws.reply('cns.stimulations.facets.result');
        expect(facets.byNeuron.find((f: any) => f.name === 'neuronA').count).toBe(3);

        const ws2 = makeWs();
        await server.handleMessage(
            ws2 as any,
            JSON.stringify({
                type: 'cns.stimulations.list',
                requestId: 'r',
                filter: { neuronName: 'neuronA' },
            })
        );
        expect(ws2.reply('cns.stimulations.list.result').stimulations).toHaveLength(3);

        const ws3 = makeWs();
        await server.handleMessage(
            ws3 as any,
            JSON.stringify({
                type: 'cns.stimulations.list',
                requestId: 'r',
                filter: { neuronName: 'nonexistent' },
            })
        );
        expect(ws3.reply('cns.stimulations.list.result').stimulations).toHaveLength(0);
    });

    it('detail returns attempts + tasks buckets (not a tree)', async () => {
        const ws = makeWs();
        await server.handleMessage(
            ws as any,
            JSON.stringify({
                type: 'cns.stimulation.detail',
                requestId: 'r',
                stimulationId: 's2',
            })
        );
        const res = ws.reply('cns.stimulation.detail.result');
        expect(res.attempts).toHaveLength(1);
        expect(res.attempts[0].stimulationId).toBe('s2');
        expect(res.tasks).toHaveLength(1);
        expect(res.tasks[0].neuronName).toBe('neuronA');
        // flat buckets: tasks are NOT nested inside attempts
        expect(res.attempts[0].tasks).toBeUndefined();
    });
});
