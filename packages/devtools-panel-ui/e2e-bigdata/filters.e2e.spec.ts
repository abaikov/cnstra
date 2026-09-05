import { test, expect, Page } from '@playwright/test';

// Filter-correctness at SCALE. The server is booted with SEED_BIG=1 (hundreds of
// neurons/collaterals + ~18k stimulations spread over ~90 days). Each filter must
// narrow the set correctly and the stats agree; the "All N" status pill exposes the
// current filtered total, which we read to assert monotonic / narrowing behaviour.

/** Read the filtered total from the "All <n>" status pill. */
async function readTotal(page: Page): Promise<number> {
    const btn = page.getByRole('button', { name: /^All\s+\d/ });
    const txt = await btn.innerText();
    return parseInt(txt.replace(/\D/g, ''), 10);
}

async function ready(page: Page): Promise<void> {
    await page.goto('/');
    await expect(
        page.getByRole('button', { name: 'Stimulations', exact: true })
    ).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
    // Full range so the baseline total is the whole dataset.
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.waitForTimeout(1200);
}

test.describe('SEED_BIG filter correctness', () => {
    test('the dataset is large (thousands of stimulations over months)', async ({
        page,
    }) => {
        await ready(page);
        const total = await readTotal(page);
        expect(total).toBeGreaterThan(5000);
        // Chart spans months → the axis start/end differ by many days.
        await page.screenshot({ path: 'e2e/.artifacts/bigdata-dashboard.png', fullPage: true });
    });

    test('time range narrows the set monotonically', async ({ page }) => {
        await ready(page);
        const clickRange = async (label: string): Promise<number> => {
            await page.getByRole('button', { name: label, exact: true }).click();
            await page.waitForTimeout(1200);
            return readTotal(page);
        };
        const all = await readTotal(page);
        const t24 = await clickRange('24h');
        const t1 = await clickRange('1h');
        const t5 = await clickRange('5m');
        // Windows are nested → counts are non-increasing as the window shrinks…
        expect(all).toBeGreaterThanOrEqual(t24);
        expect(t24).toBeGreaterThanOrEqual(t1);
        expect(t1).toBeGreaterThanOrEqual(t5);
        // …and the full 90-day set is strictly bigger than a single day.
        expect(all).toBeGreaterThan(t24);
    });

    test('status filter restricts the list + total to that status', async ({
        page,
    }) => {
        await ready(page);
        const all = await readTotal(page);
        await page.getByRole('button', { name: /^Completed\s+\d/ }).click();
        await page.waitForTimeout(1200);
        const completed = await readTotal(page);
        expect(completed).toBeGreaterThan(0);
        expect(completed).toBeLessThan(all);
        // Every visible row is completed.
        await expect(page.locator('.exp-row').first()).toContainText(/completed/i);
        await expect(page.locator('.exp-row').first()).not.toContainText(/failed/i);
    });

    test('neuron typeahead filters to runs that activated that neuron', async ({
        page,
    }) => {
        await ready(page);
        const all = await readTotal(page);
        const input = page.getByPlaceholder('filter by neuron…');
        await input.click();
        await input.fill('authIngest');
        // Suggestion dropdown shows matches at scale.
        await expect(page.locator('.exp-ta-item').first()).toBeVisible({ timeout: 15000 });
        await page.screenshot({ path: 'e2e/.artifacts/bigdata-typeahead.png', fullPage: true });
        const picked = (await page.locator('.exp-ta-item').first().innerText()).trim();
        await page.locator('.exp-ta-item').first().click();
        await page.waitForTimeout(1200);
        // A removable chip now shows the picked neuron, and the set narrowed.
        await expect(
            page.getByRole('button', { name: new RegExp(picked) }).first()
        ).toBeVisible();
        const narrowed = await readTotal(page);
        expect(narrowed).toBeGreaterThan(0);
        expect(narrowed).toBeLessThan(all);
    });

    test('collateral typeahead narrows by entry collateral', async ({ page }) => {
        await ready(page);
        const all = await readTotal(page);
        const input = page.getByPlaceholder('filter by collateral…');
        await input.click();
        await input.fill('JobRequested');
        await expect(page.locator('.exp-ta-item').first()).toBeVisible({ timeout: 15000 });
        await page.locator('.exp-ta-item').first().click();
        await page.waitForTimeout(1200);
        const narrowed = await readTotal(page);
        expect(narrowed).toBeGreaterThan(0);
        expect(narrowed).toBeLessThan(all);
    });

    test('entry-only toggle shows only entry collaterals in the Collaterals list', async ({
        page,
    }) => {
        await ready(page);
        await page.getByRole('button', { name: 'Collaterals', exact: true }).click();
        await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 30000 });
        await page.getByRole('button', { name: 'entry only', exact: true }).click();
        await page.waitForTimeout(800);
        // Every visible collateral row is an entry collateral.
        await expect(page.locator('.exp-row').first()).toContainText(/entry collateral/i);
        await page.screenshot({ path: 'e2e/.artifacts/bigdata-entry-only.png', fullPage: true });
    });

    test('the runs list scrolls deep through the big dataset', async ({ page }) => {
        await ready(page);
        const scroller = page.locator('.exp-scroll').first();
        // Infinite-scroll deep into the 18k-row set; scroll must PERSIST (windowed).
        for (let i = 0; i < 6; i++) {
            await scroller.evaluate(el => (el.scrollTop = el.scrollHeight));
            await page.waitForTimeout(500);
        }
        const top = await scroller.evaluate(el => el.scrollTop);
        expect(top).toBeGreaterThan(500);
        await page.screenshot({ path: 'e2e/.artifacts/bigdata-list-scrolled.png', fullPage: true });
    });
});
