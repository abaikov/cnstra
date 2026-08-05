import { test, expect } from '@playwright/test';

// The faceted Explorer, fed live from the server's name-based stimulation store
// (the same runs a bull/pg-boss worker would `observe`). The demo app emits
// stimulations continuously via the trackStimulations producer path, so real
// runs + facets show up here. The Explorer is the ONLY surface — it's the landing
// page, so no nav click is needed to reach it.
test.describe('Explorer', () => {
    test('lands on the Explorer, shows facets/runs, and the Chart view renders', async ({
        page,
    }) => {
        await page.goto('/');

        // Facet rail is present (its lens switch + Status section) with no nav click.
        await expect(page.getByRole('button', { name: 'Collaterals' })).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText('Status', { exact: true })).toBeVisible();

        // The roster header ("<n> runs") is always rendered.
        await expect(page.getByText(/\d+ runs/).first()).toBeVisible({
            timeout: 60000,
        });

        // The heartbeat monitor mounts a live ECG strip in the top bar.
        const beat = page.locator('[title="live stimulation activity"] polyline');
        await expect(beat).toHaveCount(1, { timeout: 60000 });

        // Wait for the demo to emit a real run so the roster is populated, then
        // capture the redesign screenshot (Runs view, populated).
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 60000,
        });
        await page.waitForTimeout(1500); // let a few beats scroll
        await page.screenshot({ path: 'e2e/.artifacts/redesign.png', fullPage: true });
        expect((await beat.getAttribute('points'))?.length).toBeGreaterThan(20);

        // Switch to the Chart view — it must mount (the labelled throughput chart or
        // the empty state), never throw.
        await page.getByRole('button', { name: 'Chart', exact: true }).click();
        await expect(
            page
                .getByText('Throughput', { exact: true })
                .or(page.getByText('No runs in range.'))
                .first()
        ).toBeVisible({ timeout: 60000 });
        await page.screenshot({ path: 'e2e/.artifacts/redesign-chart.png', fullPage: true });

        // Neurons lens toggles the facet dimension without error.
        await page.getByRole('button', { name: 'Neurons' }).click();
        await expect(page.getByText('Neuron', { exact: true })).toBeVisible();
    });
});
