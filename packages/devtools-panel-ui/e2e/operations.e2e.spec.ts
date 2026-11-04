import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STIMULATION_PAGE_LIMIT } from '../src/model/constants/STIMULATION_PAGE_LIMIT';

const ROW_HEIGHT_PX = 52;
const WINDOW_OVERSCAN_ROWS = 8;
const REFETCH_SLICE_MS = 1024;
const SETTLE_MS = 3 * REFETCH_SLICE_MS;

type TSyncRequest = { atMs: number; receptorNames: readonly string[] };

type TMutationProbe = {
    records: MutationRecord[];
    observer: MutationObserver;
    settledRows: WeakSet<Element>;
    describe(record: MutationRecord): string;
};

type TMutationProbeWindow = Window & { mutationProbe?: TMutationProbe };

const receptorNamesOf = (encodedRequests: string): string[] =>
    encodedRequests
        .split('&')
        .filter(Boolean)
        .map(group => decodeURIComponent(group.slice(0, group.indexOf('='))));

const recordSyncRequests = (page: Page): TSyncRequest[] => {
    const syncRequests: TSyncRequest[] = [];
    page.on('websocket', socket => {
        socket.on('framesent', frame => {
            if (typeof frame.payload !== 'string') return;
            let message: { type?: unknown; encodedRequests?: unknown };
            try {
                message = JSON.parse(frame.payload);
            } catch {
                return;
            }
            if (message?.type !== 'sync.request' || typeof message.encodedRequests !== 'string') return;
            syncRequests.push({ atMs: Date.now(), receptorNames: receptorNamesOf(message.encodedRequests) });
        });
    });
    return syncRequests;
};

const runningCount = (page: Page) =>
    page.locator('.legend-item', { hasText: 'running' }).locator('.legend-count');

const openSettledStimulations = async (page: Page): Promise<void> => {
    await page.goto('/');
    await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
    const untilMs = await page.evaluate(() => Date.now());
    await page.evaluate(until => {
        window.location.hash = `#/?until=${until}`;
    }, untilMs);
    await page.waitForTimeout(SETTLE_MS);
    await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
    await expect(runningCount(page)).toHaveText('0', { timeout: 60000 });
    await page.waitForTimeout(SETTLE_MS);
};

const startMutationProbe = (page: Page): Promise<void> =>
    page.evaluate(() => {
        const elementOf = (node: Node | null): Element | null =>
            node === null ? null : node instanceof Element ? node : node.parentElement;
        const pathOf = (element: Element | null): string => {
            const parts: string[] = [];
            for (let current = element; current !== null && current !== document.body && parts.length < 4; current = current.parentElement) {
                const className = current.getAttribute('class');
                const tagName = current.tagName.toLowerCase();
                parts.unshift(className ? `${tagName}.${className.trim().split(/\s+/).join('.')}` : tagName);
            }
            return parts.join(' > ');
        };
        const settledRows = new WeakSet<Element>();
        for (const row of Array.from(document.querySelectorAll('.exp-row'))) {
            const status = row.querySelector('.row-right > span:last-child > span:last-child')?.textContent;
            if (status === 'completed' || status === 'failed') settledRows.add(row);
        }
        const records: MutationRecord[] = [];
        const observer = new MutationObserver(batch => {
            records.push(...batch);
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        (window as TMutationProbeWindow).mutationProbe = {
            records,
            observer,
            settledRows,
            describe: record =>
                `${record.type}${record.attributeName ? `[${record.attributeName}]` : ''} @ ${pathOf(elementOf(record.target))}`,
        };
    });

const takeMutations = (page: Page): Promise<string[]> =>
    page.evaluate(() => {
        const probe = (window as TMutationProbeWindow).mutationProbe!;
        probe.records.push(...probe.observer.takeRecords());
        probe.observer.disconnect();
        return probe.records.map(record => probe.describe(record));
    });

const takeMutationsOutsideRunAndCounters = (page: Page): Promise<string[]> =>
    page.evaluate(() => {
        const probe = (window as TMutationProbeWindow).mutationProbe!;
        probe.records.push(...probe.observer.takeRecords());
        probe.observer.disconnect();
        const spacer = document.querySelector('.exp-scroll')?.firstElementChild ?? null;
        const graphsZone =
            Array.from(document.querySelectorAll('.exp-heading')).find(heading => heading.textContent === 'Graphs · Vitals')?.parentElement
                ?.parentElement ?? null;
        const isAllowed = (record: MutationRecord): boolean => {
            const element = record.target instanceof Element ? record.target : record.target.parentElement;
            if (element === null) return false;
            const row = element.closest('.exp-row');
            if (row !== null) {
                if (!probe.settledRows.has(row)) return true;
                return record.type === 'attributes' && record.target === row && record.attributeName === 'style';
            }
            if (element === spacer) return true;
            if (element.closest('.fg-status') !== null) return true;
            return graphsZone !== null && graphsZone.contains(element);
        };
        return probe.records.filter(record => !isAllowed(record)).map(record => probe.describe(record));
    });

const cloneThroughOwnSocket = (page: Page, stimulationId: string): Promise<string> =>
    page.evaluate(
        sourceStimulationId =>
            new Promise<string>((resolve, reject) => {
                const requestId = `operations-e2e-${Date.now()}`;
                const socket = new WebSocket(window.location.origin.replace(/^http/, 'ws'));
                socket.addEventListener('open', () => {
                    socket.send(JSON.stringify({ type: 'stimulation.clone', requestId, stimulationId: sourceStimulationId }));
                });
                socket.addEventListener('message', event => {
                    let message: { type?: string; requestId?: string; newStimulationId?: string; reason?: string };
                    try {
                        message = JSON.parse(String(event.data));
                    } catch {
                        return;
                    }
                    if (message.requestId !== requestId) return;
                    socket.close();
                    if (message.type === 'stimulation.clone.accepted' && message.newStimulationId) resolve(message.newStimulationId);
                    else reject(new Error(message.reason ?? `clone answered ${message.type}`));
                });
                socket.addEventListener('error', () => reject(new Error('clone socket failed')));
            }),
        stimulationId
    );

const listedRowCount = (page: Page): Promise<number> =>
    page
        .locator('.exp-scroll > .exp-rows')
        .first()
        .evaluate(spacer => Number.parseInt(getComputedStyle(spacer).getPropertyValue('--row-count'), 10) || 0);

const visibleRowCapacity = (page: Page): Promise<number> =>
    page
        .locator('.exp-scroll')
        .first()
        .evaluate((scroller, rowHeightPx) => Math.ceil(scroller.clientHeight / rowHeightPx), ROW_HEIGHT_PX);

test.describe('Panel does the minimum work', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('an idle poll leaves the DOM untouched', async ({ page }) => {
        test.setTimeout(120000);
        const syncRequests = recordSyncRequests(page);
        await openSettledStimulations(page);
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

        await startMutationProbe(page);
        const observedFromMs = Date.now();
        await page.waitForTimeout(6 * REFETCH_SLICE_MS);
        const mutations = await takeMutations(page);

        expect(syncRequests.filter(request => request.atMs >= observedFromMs).length).toBeGreaterThanOrEqual(2);
        expect({ count: mutations.length, first: mutations.slice(0, 30) }).toEqual({ count: 0, first: [] });
    });

    test('each poll tick sends one sync.request that carries every due receptor', async ({ page }) => {
        test.setTimeout(120000);
        const syncRequests = recordSyncRequests(page);
        await openSettledStimulations(page);

        const windowSlices = 16;
        const windowFromMs = Date.now();
        await page.waitForTimeout(windowSlices * REFETCH_SLICE_MS);
        const windowUntilMs = Date.now();
        const windowRequests = syncRequests.filter(request => request.atMs >= windowFromMs && request.atMs < windowUntilMs);
        const ticks = new Set(windowRequests.map(request => Math.floor(request.atMs / REFETCH_SLICE_MS)));

        expect(windowRequests.length).toBeGreaterThanOrEqual(4);
        expect(windowRequests.length).toBe(ticks.size);
        expect(windowRequests.length).toBeLessThanOrEqual(windowSlices + 1);
        expect(Math.max(...windowRequests.map(request => request.receptorNames.length))).toBeGreaterThanOrEqual(2);
        expect([...new Set(windowRequests.flatMap(request => request.receptorNames))]).toEqual(
            expect.arrayContaining(['stimulationPage', 'stimulationFacets', 'stimulationSnapshot', 'topology'])
        );
    });

    test('a new run mutates only its row, the row positions and the counters', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
        await expect(runningCount(page)).toHaveText('0', { timeout: 60000 });
        await page.waitForTimeout(SETTLE_MS);
        const sourceStimulationId = (await page.locator('.exp-row .row-sub').first().textContent()) ?? '';
        expect(sourceStimulationId).not.toBe('');

        await startMutationProbe(page);
        const newStimulationId = await cloneThroughOwnSocket(page, sourceStimulationId);
        const newRow = page.locator('.exp-row', { has: page.locator('.row-sub', { hasText: newStimulationId }) });
        await expect(newRow).toBeVisible({ timeout: 30000 });
        await expect(newRow).toContainText(/completed|failed/, { timeout: 30000 });
        await page.waitForTimeout(SETTLE_MS);
        const strayMutations = await takeMutationsOutsideRunAndCounters(page);

        expect({ count: strayMutations.length, first: strayMutations.slice(0, 30) }).toEqual({ count: 0, first: [] });
    });

    test('the list keeps at most one page listed and only the visible window in the DOM', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
        const capacity = await visibleRowCapacity(page);

        for (let poll = 0; poll < 3; poll++) {
            const listed = await listedRowCount(page);
            expect(listed).toBeLessThanOrEqual(STIMULATION_PAGE_LIMIT);
            expect(await page.locator('.exp-row').count()).toBeLessThanOrEqual(Math.min(listed, capacity + WINDOW_OVERSCAN_ROWS));
            await page.waitForTimeout(2 * REFETCH_SLICE_MS);
        }

        const listedBeforeScroll = await listedRowCount(page);
        test.skip(
            listedBeforeScroll < STIMULATION_PAGE_LIMIT,
            `only ${listedBeforeScroll} stimulations exist; the next page needs more than ${STIMULATION_PAGE_LIMIT}`
        );

        await page
            .locator('.exp-scroll')
            .first()
            .evaluate(scroller => {
                scroller.scrollTop = scroller.scrollHeight;
            });
        await expect.poll(() => listedRowCount(page), { timeout: 30000 }).toBeGreaterThan(STIMULATION_PAGE_LIMIT);
        expect(await page.locator('.exp-row').count()).toBeLessThanOrEqual(capacity + 2 * WINDOW_OVERSCAN_ROWS);
    });
});
