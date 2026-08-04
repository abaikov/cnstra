import { createExplorerController } from './explorerController';
import type { CNSExplorerWsClient } from './explorerClient';

const row = (id: string, col = 'import-doc', status = 'completed') => ({
    stimulationId: id,
    entry: { collateralName: col, payload: {} },
    status,
    startedAt: 1,
    completedAt: 2,
    hopCount: 1,
    hasError: status === 'failed',
});

const flush = () => new Promise(r => setTimeout(r, 0));

function makeClient(): CNSExplorerWsClient {
    return {
        list: jest.fn(async (_q: any, cursor?: string) =>
            cursor
                ? { stimulations: [row('s3')], nextCursor: null }
                : { stimulations: [row('s1'), row('s2')], nextCursor: 'cur', total: 3 }
        ),
        facets: jest.fn(async () => ({
            byEntryCollateral: [{ name: 'import-doc', count: 2 }],
            byStatus: [{ status: 'failed', count: 1 }],
        })),
        detail: jest.fn(async (id: string) => ({
            attempts: [{ stimulationId: id } as any],
            tasks: [{ neuronName: 'n' } as any],
        })),
    } as unknown as CNSExplorerWsClient;
}

describe('explorerController', () => {
    it('start() loads page-1 rows + facets + total', async () => {
        const c = createExplorerController(makeClient(), { liveMs: 0 });
        c.start();
        await flush();
        expect(c.rows.getValue().map(r => r.stimulationId)).toEqual(['s1', 's2']);
        expect(c.total.getValue()).toBe(3);
        expect(c.hasMore.getValue()).toBe(true);
        expect(c.facets.getValue().byStatus[0].count).toBe(1);
    });

    it('loadMore() appends the next page and clears hasMore', async () => {
        const c = createExplorerController(makeClient(), { liveMs: 0 });
        c.start();
        await flush();
        await c.loadMore();
        expect(c.rows.getValue().map(r => r.stimulationId)).toEqual([
            's1',
            's2',
            's3',
        ]);
        expect(c.hasMore.getValue()).toBe(false);
    });

    it('selectRun() fetches detail and updates the query', async () => {
        const c = createExplorerController(makeClient(), { liveMs: 0 });
        c.start();
        await flush();
        await c.selectRun('s2');
        expect(c.query.getValue().selected).toBe('s2');
        expect(c.query.getValue().view).toBe('waterfall');
        expect(c.detail.getValue()?.attempts[0].stimulationId).toBe('s2');
    });

    it('setQuery() writes the URL and refetches', async () => {
        const writes: string[] = [];
        const c = createExplorerController(makeClient(), {
            liveMs: 0,
            writeSearch: s => writes.push(s),
        });
        c.setQuery({ status: 'failed' });
        await flush();
        expect(c.query.getValue().status).toBe('failed');
        expect(writes.some(s => s.includes('status=failed'))).toBe(true);
    });

    it('restores query from the URL on construction', async () => {
        const c = createExplorerController(makeClient(), {
            liveMs: 0,
            readSearch: () => 'status=running&col=send-email',
        });
        expect(c.query.getValue().status).toBe('running');
        expect(c.query.getValue().entryCollateralName).toBe('send-email');
    });
});
