import { test, expect } from '@playwright/test';

// The faceted Explorer, fed live from the server's name-based stimulation store
// (the same runs a bull/pg-boss worker would `observe`). The demo app emits
// stimulations continuously via the trackStimulations producer path, so real
// runs + facets show up here.
test.describe('Explorer', () => {
    test('opens, shows facets/runs, and the Chart view renders without crashing', async ({
        page,
    }) => {
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });

        await page.getByRole('button', { name: /Explorer/ }).click();

        // Facet rail is present (its lens switch + Status section).
        await expect(page.getByRole('button', { name: 'Collaterals' })).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText('Status', { exact: true })).toBeVisible();

        // The roster header ("<n> runs") is always rendered.
        await expect(page.getByText(/\d+ runs/).first()).toBeVisible({
            timeout: 60000,
        });

        // The heartbeat monitor mounts a live ECG strip in the header.
        const beat = page.locator('[title="live stimulation activity"] polyline');
        await expect(beat).toHaveCount(1, { timeout: 60000 });
        await page.waitForTimeout(1500); // let the demo emit + a few beats scroll
        await page.screenshot({ path: 'e2e/.artifacts/explorer-heartbeat.png' });
        expect((await beat.getAttribute('points'))?.length).toBeGreaterThan(20);

        // Switch to the Chart view — it must mount (either a histogram or the
        // empty state), never throw.
        await page.getByRole('button', { name: 'Chart', exact: true }).click();
        await expect(
            page
                .getByText(/runs per bucket/)
                .or(page.getByText('No runs in range.'))
                .first()
        ).toBeVisible({ timeout: 60000 });

        // Neurons lens toggles the facet dimension without error.
        await page.getByRole('button', { name: 'Neurons' }).click();
        await expect(page.getByText('Neuron', { exact: true })).toBeVisible();

        // Map view mounts (heat-map or empty state), never throws.
        await page.getByRole('button', { name: 'Map', exact: true }).click();
        await expect(
            page
                .getByText(/activation · tile size/)
                .or(page.getByText('No activation to map.'))
                .first()
        ).toBeVisible({ timeout: 60000 });
    });
});
