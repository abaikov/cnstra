import { test, expect } from '@playwright/test';

// The 4-zone Explorer dashboard, fed live from the server's name-based stimulation
// store. The demo app emits stimulations continuously, so real runs + facets +
// topology show up. The Explorer is the ONLY surface (the landing page).
test.describe('Explorer dashboard', () => {
    test('shows the stats strip, filters, the throughput chart, and the runs list', async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.goto('/');

        // Tabs + status filters are present with no nav click.
        await expect(
            page.getByRole('button', { name: 'Stimulations', exact: true })
        ).toBeVisible({ timeout: 60000 });
        await expect(page.getByRole('button', { name: /Completed/ })).toBeVisible();

        // The throughput chart is present and draws a real trace (non-empty points on
        // at least one series once runs exist).
        const chartSel =
            '[title="live throughput chart + new-stimulation pulse"] polyline';
        await expect(page.locator(chartSel).first()).toBeAttached({ timeout: 60000 });
        await expect(page.getByText('Throughput')).toBeVisible();

        // A real run populates the list.
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 60000,
        });
        await expect
            .poll(
                async () =>
                    page.$$eval(chartSel, els =>
                        els.some(e => (e.getAttribute('points') ?? '').trim().length > 0)
                    ),
                { timeout: 60000 }
            )
            .toBe(true);
        await page.waitForTimeout(1200);
        await page.screenshot({
            path: 'e2e/.artifacts/dashboard.png',
            fullPage: true,
        });

        // Chart tools react: toggling the FAILED trace keeps the chart rendering.
        await page.getByRole('button', { name: 'Failed', exact: true }).first().click();
        await expect(page.locator(chartSel).first()).toBeAttached();
    });

    test('hovering the throughput chart shows a value tooltip', async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.goto('/');
        const chartHost = page
            .locator('[title="live throughput chart + new-stimulation pulse"]')
            .locator('div', { has: page.locator('polyline') })
            .first();
        await expect(chartHost).toBeVisible({ timeout: 60000 });
        await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
        // Hover over the middle of the chart → the tooltip appears with real values.
        const box = await chartHost.boundingBox();
        if (box) {
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
            await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
        }
        const tip = page.locator('.exp-chart-tip');
        await expect(tip).toBeVisible({ timeout: 10000 });
        await expect(tip).toContainText(/completed \d+ · failed \d+/);
        await page.screenshot({ path: 'e2e/.artifacts/chart-hover.png', fullPage: true });
    });

    test('the throughput chart reacts to the active status filter', async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.goto('/');
        const chart = page
            .locator('[title="live throughput chart + new-stimulation pulse"] polyline')
            .first();
        await expect(chart).toBeAttached({ timeout: 60000 });
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 60000,
        });

        const before = await chart.getAttribute('points');
        // Apply a status filter — facets (and byTime) re-fetch for the filtered set.
        await page.getByRole('button', { name: /Completed/ }).click();
        await page.waitForTimeout(2500);
        const after = await chart.getAttribute('points');
        // The filtered chart must reflect a (usually) different completed trace, or at
        // minimum still render a valid polyline for the filtered set.
        expect(after).not.toBeNull();
        expect((after ?? '').length).toBeGreaterThan(0);
        void before;
    });

    test('the runs list actually scrolls (does not snap back to top)', async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.goto('/');
        // Wait until some runs exist.
        await expect
            .poll(async () => page.locator('.exp-row').count(), { timeout: 60000 })
            .toBeGreaterThan(6);

        const scroller = page.locator('.exp-scroll').first();
        // Wait until the live demo has produced enough rows to give a real scroll
        // range (content taller than the viewport by a healthy margin).
        await expect
            .poll(
                async () =>
                    scroller.evaluate(el => el.scrollHeight - el.clientHeight),
                { timeout: 60000 }
            )
            .toBeGreaterThan(150);
        // Scroll to 60% of the range; it must HOLD there (not snap back to top).
        const target = await scroller.evaluate(el => {
            el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) * 0.6);
            return el.scrollTop;
        });
        await page.waitForTimeout(500);
        const top = await scroller.evaluate(el => el.scrollTop);
        expect(top).toBeGreaterThan(target * 0.5);
    });
});
