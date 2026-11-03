import { createExplorerController } from '.././explorerController';
import type { CNSExplorerWsClient } from '.././explorerClient';

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
            byNeuron: [],
            byTime: [],
        })),
        detail: jest.fn(async (id: string) => ({
            attempts: [{ stimulationId: id } as any],
            tasks: [{ neuronName: 'n' } as any],
        })),
        topology: jest.fn(async () => ({
            neurons: [],
            collaterals: [],
            dendrites: [],
        })),
        snapshot: jest.fn(async () => ({
            stimulations: [],
            attempts: [],
            tasks: [],
        })),
        clone: jest.fn(async (_id: string) => 'new-run-42'),
        retry: jest.fn(async (_id: string) => undefined),
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

    it('cloneRun() surfaces a success notice naming the new run', async () => {
        const c = createExplorerController(makeClient(), { liveMs: 0 });
        c.start();
        await flush();
        await c.cloneRun('s1');
        expect(c.actionNotice.getValue()).toBe('Cloned → new run new-run-42');
        expect(c.actionError.getValue()).toBeNull();
    });

    it('opens on the window the server asked for', async () => {
        // Every Explorer view is time-ordered, and an unbounded first query makes
        // the store aggregate its whole history to draw one page.
        const c = createExplorerController(makeClient() as any, { liveMs: 0 });
        c.start();
        await flush();

        const before = Date.now();
        c.applyDefaultWindow(5 * 60_000);

        const since = c.query.getValue().since!;
        expect(since).toBeGreaterThanOrEqual(before - 5 * 60_000 - 50);
        expect(since).toBeLessThanOrEqual(Date.now() - 5 * 60_000 + 50);
    });

    it('does not move a range the user already chose', async () => {
        // A shared link must land where it says; a window that reasserted itself
        // would move someone off the run they were sent to look at.
        const c = createExplorerController(makeClient() as any, {
            liveMs: 0,
            readSearch: () => '?since=1000',
        });
        c.start();
        await flush();

        c.applyDefaultWindow(5 * 60_000);

        expect(c.query.getValue().since).toBe(1000);
    });

    it('treats a zero window as no window at all', async () => {
        const c = createExplorerController(makeClient() as any, { liveMs: 0 });
        c.start();
        await flush();

        c.applyDefaultWindow(0);

        expect(c.query.getValue().since).toBeUndefined();
    });

    it('does not send an action the server turned off', async () => {
        // Retry and Clone are different operations: Retry updates the SAME run's
        // record in place, Clone leaves it alone. A deployment that must never
        // overwrite a record turns Retry off, and the panel must honour that even
        // if something calls the controller directly.
        const retry = jest.fn(async () => {});
        const clone = jest.fn(async () => 'new-run-42');
        const c = createExplorerController(
            { ...makeClient(), retry, clone } as any,
            { liveMs: 0, allowedActions: { retry: false } }
        );
        c.start();
        await flush();

        await c.retryRun('s1');
        await c.cloneRun('s1');

        expect(retry).not.toHaveBeenCalled();
        expect(clone).toHaveBeenCalledTimes(1);
    });

    it('allows everything the server did not turn off', async () => {
        const retry = jest.fn(async () => {});
        const c = createExplorerController(
            { ...makeClient(), retry } as any,
            { liveMs: 0 }
        );
        c.start();
        await flush();

        await c.retryRun('s1');

        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('marks the action pending while it is in flight, and clears it after', async () => {
        // The button reads this to go dead. Without it a click gives no feedback,
        // and the second one sends a second command carrying the same attempt id.
        let release!: () => void;
        const held = new Promise<void>(resolve => (release = resolve));
        const c = createExplorerController(
            {
                ...makeClient(),
                retry: jest.fn(async () => {
                    await held;
                }),
            } as any,
            { liveMs: 0 }
        );
        c.start();
        await flush();

        expect(c.actionPending.getValue()).toBeNull();
        const inFlight = c.retryRun('s1');
        expect(c.actionPending.getValue()).toBe('retry');

        release();
        await inFlight;
        expect(c.actionPending.getValue()).toBeNull();
    });

    it('drops a second click while the first is still running', async () => {
        let release!: () => void;
        const held = new Promise<void>(resolve => (release = resolve));
        const retry = jest.fn(async () => {
            await held;
        });
        const c = createExplorerController(
            { ...makeClient(), retry } as any,
            { liveMs: 0 }
        );
        c.start();
        await flush();

        const first = c.retryRun('s1');
        await c.retryRun('s1'); // the impatient second click
        release();
        await first;

        // One command sent, not two.
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('clears the pending flag even when the action is rejected', async () => {
        const c = createExplorerController(
            {
                ...makeClient(),
                retry: jest.fn(async () => {
                    throw new Error('no runtime accepted the retry');
                }),
            } as any,
            { liveMs: 0 }
        );
        c.start();
        await flush();

        await c.retryRun('s1');

        expect(c.actionPending.getValue()).toBeNull();
        expect(c.actionError.getValue()).toBe('no runtime accepted the retry');
    });

    it('retryRun() surfaces a success notice; a rejected action surfaces the error', async () => {
        const c = createExplorerController(makeClient(), { liveMs: 0 });
        c.start();
        await flush();
        await c.retryRun('s1');
        expect(c.actionNotice.getValue()).toBe('Retry accepted — resuming this run');

        // A rejected clone clears the notice and shows the error instead.
        const failing = createExplorerController(
            {
                ...makeClient(),
                clone: jest.fn(async () => {
                    throw new Error('clone rejected');
                }),
            } as any,
            { liveMs: 0 }
        );
        failing.start();
        await flush();
        await failing.cloneRun('s1');
        expect(failing.actionError.getValue()).toBe('clone rejected');
        expect(failing.actionNotice.getValue()).toBeNull();
    });

    it('restores query from the URL on construction', async () => {
        const c = createExplorerController(makeClient(), {
            liveMs: 0,
            readSearch: () => 'status=running&col=send-email',
        });
        expect(c.query.getValue().status).toBe('running');
        expect(c.query.getValue().entryCollateralName).toBe('send-email');
    });
    it('loads the scheduled list on its tab, appends the next page, and scopes it to an opened neuron or collateral', async () => {
        const scheduledRow = (id: string) => ({
            stimulationId: id,
            entry: { collateralName: 'orderPlaced', payload: {} },
            status: 'scheduled',
            runAfter: 1,
            priority: 0,
            attemptCount: 0,
            resumes: false,
            tasks: [{ neuronName: 'charge', dendriteCollateralName: 'orderPlaced' }],
        });
        const scheduled = jest.fn(async (filter: any, cursor?: string) => ({
            available: true,
            rows: [scheduledRow(cursor ? 'j3' : filter.neuronName ? 'n1' : filter.collateralName ? 'c1' : 'j1')],
            schedules: [],
            types: [],
            nextCursor: cursor || filter.neuronName || filter.collateralName ? null : 'next',
        }));
        const c = createExplorerController({ ...makeClient(), scheduled } as any, { liveMs: 0 });
        c.start();
        await flush();
        expect(scheduled).not.toHaveBeenCalled();

        c.setQuery({ tab: 'scheduled' });
        await flush();
        await c.loadMoreScheduled();
        c.openEntity({ kind: 'neuron', id: 'charge', label: 'charge' }, true);
        await flush();
        const atNeuron = c.scopedScheduled.getValue();
        c.openEntity({ kind: 'collateral', id: 'orderPlaced', label: 'orderPlaced' });
        await flush();

        expect(c.scheduled.getValue().rows.map(row => row.stimulationId)).toEqual(['j1', 'j3']);
        expect(atNeuron?.rows.map(row => row.stimulationId)).toEqual(['n1']);
        expect(c.scopedScheduled.getValue()?.rows.map(row => row.stimulationId)).toEqual(['c1']);
        expect(scheduled).toHaveBeenCalledWith({ neuronName: 'charge' }, undefined, 50);
        expect(scheduled).toHaveBeenCalledWith({ collateralName: 'orderPlaced' }, undefined, 50);
    });
    it('keeps an appended scheduled list through live ticks, and scans a scoped section on past an empty page', async () => {
        const scheduledRow = (id: string) => ({
            stimulationId: id,
            entry: { collateralName: 'orderPlaced', payload: {} },
            status: 'ready',
            runAfter: 1,
            priority: 0,
            attemptCount: 0,
            resumes: false,
            tasks: [],
        });
        const scheduled = jest.fn(async (filter: any, cursor?: string) => {
            if (filter.neuronName) return cursor ? { available: true, rows: [scheduledRow('found')], schedules: [], types: [], nextCursor: null } : { available: true, rows: [], schedules: [], types: [], nextCursor: 'scan-on' };
            return cursor ? { available: true, rows: [scheduledRow('second')], schedules: [], types: [], nextCursor: null } : { available: true, rows: [scheduledRow('first')], schedules: [], types: [], nextCursor: 'more' };
        });
        const c = createExplorerController({ ...makeClient(), scheduled } as any, { liveMs: 5 });
        c.start();
        c.setQuery({ tab: 'scheduled' });
        await new Promise(r => setTimeout(r, 20));
        await c.loadMoreScheduled();
        await new Promise(r => setTimeout(r, 30));
        const afterTicks = c.scheduled.getValue().rows.map(row => row.stimulationId);
        c.openEntity({ kind: 'neuron', id: 'charge', label: 'charge' }, true);
        await flush();
        const scannedEmpty = c.scopedScheduled.getValue();
        await c.loadMoreScopedScheduled();
        await new Promise(r => setTimeout(r, 30));
        c.stop();

        expect(afterTicks).toEqual(['first', 'second']);
        expect(scannedEmpty).toMatchObject({ rows: [], nextCursor: 'scan-on' });
        expect(c.scopedScheduled.getValue()?.rows.map(row => row.stimulationId)).toEqual(['found']);
    });
    it('sends a command for a scheduled job, reloads the list, and reports a rejection', async () => {
        const command = jest.fn(async (_id: string, value: any) => {
            if (value.name === 'cancel') throw new Error('job "j1" has already finished');
        });
        const scheduled = jest.fn(async () => ({ available: true, rows: [], schedules: [], types: [], nextCursor: null }));
        const c = createExplorerController({ ...makeClient(), scheduled, command } as any, { liveMs: 0 });
        c.start();
        c.setQuery({ tab: 'scheduled' });
        await flush();
        const loadsBefore = scheduled.mock.calls.length;

        await c.commandScheduled('j1', { name: 'prioritize', priority: 2 });
        const notice = c.actionNotice.getValue();
        await c.commandScheduled('j1', { name: 'cancel' });

        expect(command).toHaveBeenCalledWith('j1', { name: 'prioritize', priority: 2 });
        expect(notice).toBe('j1 priority 2');
        expect(scheduled.mock.calls.length).toBeGreaterThan(loadsBefore);
        expect(c.actionError.getValue()).toBe('job "j1" has already finished');
        expect(c.actionPending.getValue()).toBeNull();
    });
    it('launches a job from the form and reports the new id, or the rejection', async () => {
        const launch = jest.fn(async (entry: any) => {
            if (entry.collateralName === 'unknown') throw new Error('no runtime accepted the launch');
            return 'orderPlaced-1';
        });
        const scheduled = jest.fn(async () => ({ available: true, rows: [], schedules: [], types: [], nextCursor: null }));
        const c = createExplorerController({ ...makeClient(), scheduled, launch } as any, { liveMs: 0 });
        c.start();

        await c.launchScheduled('orderPlaced', { orderId: 1 });
        const notice = c.actionNotice.getValue();
        await c.launchScheduled('unknown', {});

        expect(launch).toHaveBeenCalledWith({ collateralName: 'orderPlaced', payload: { orderId: 1 } });
        expect(notice).toBe('Launched orderPlaced-1');
        expect(c.actionError.getValue()).toBe('no runtime accepted the launch');
    });
});
