import { test, expect } from '@playwright/test';

// Walks all four tabs, opens each entity's DETAILS scope-card in the split-view,
// verifies the node-link diagram renders curved paths + flowing <animateMotion>
// signal dots, and screenshots every view + detail for visual verification.
test.describe('Explorer 4-zone dashboard walkthrough', () => {
    test('each tab lists its entity and opens a rich detail beside the list', async ({
        page,
    }) => {
        test.setTimeout(120000);
        await page.goto('/');

        // wait for live data (topology + at least one run)
        await expect(
            page.getByRole('button', { name: 'Stimulations', exact: true })
        ).toBeVisible({ timeout: 60000 });
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 60000,
        });
        await page.waitForTimeout(2000); // let topology + a few runs arrive

        // ── Stimulations list + detail (the pipeline) ──
        await page.locator('.exp-row').first().click();
        await expect(page.getByText(/STIMULATION · FLOW/)).toBeVisible({
            timeout: 60000,
        });
        await expect(
            page.getByRole('button', { name: 'Clone', exact: true })
        ).toBeVisible();
        // the pipeline connectors flow (animateMotion present)
        await expect
            .poll(async () => page.locator('animateMotion').count(), { timeout: 30000 })
            .toBeGreaterThan(0);
        await page.screenshot({
            path: 'e2e/.artifacts/stimulation-detail.png',
            fullPage: true,
        });

        // ── Neurons list + detail (fan-in/fan-out node-link diagram) ──
        await page.getByRole('button', { name: 'Neurons', exact: true }).click();
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 60000,
        });
        await page.screenshot({
            path: 'e2e/.artifacts/neurons-list.png',
            fullPage: true,
        });
        await page.locator('.exp-row').first().click();
        await expect(page.getByText(/NEURON · SCOPE/)).toBeVisible({
            timeout: 60000,
        });
        // curved bézier edges (cubic paths) + flowing dots in the diagram
        await expect
            .poll(async () => page.locator('svg path[d*="C"]').count(), {
                timeout: 30000,
            })
            .toBeGreaterThan(0);
        await expect
            .poll(async () => page.locator('animateMotion').count(), { timeout: 30000 })
            .toBeGreaterThan(0);
        await page.screenshot({
            path: 'e2e/.artifacts/neuron-detail.png',
            fullPage: true,
        });

        // ── Collaterals list + detail (owner → collateral → subscribers) ──
        await page.getByRole('button', { name: 'Collaterals', exact: true }).click();
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 60000,
        });
        await page.screenshot({
            path: 'e2e/.artifacts/collaterals-list.png',
            fullPage: true,
        });
        await page.locator('.exp-row').first().click();
        await expect(
            page.getByText(/COLLATERAL · (SCOPE|ENTRY)/)
        ).toBeVisible({ timeout: 60000 });
        await page.screenshot({
            path: 'e2e/.artifacts/collateral-detail.png',
            fullPage: true,
        });

        // ── Activation tasks list + detail ──
        await page
            .getByRole('button', { name: 'Activation tasks', exact: true })
            .click();
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 60000,
        });
        await page.screenshot({
            path: 'e2e/.artifacts/tasks-list.png',
            fullPage: true,
        });
        await page.locator('.exp-row').first().click();
        await expect(page.getByText(/ACTIVATION TASK/)).toBeVisible({
            timeout: 60000,
        });
        await page.screenshot({
            path: 'e2e/.artifacts/task-detail.png',
            fullPage: true,
        });

        // ── the entry-only boolean filter on the Collaterals tab ──
        await page.getByRole('button', { name: 'Collaterals', exact: true }).click();
        // The button reads "entry collaterals only"; asking for "entry only"
        // with exact:true could never match it, so this step had never run.
        await page
            .getByRole('button', { name: 'entry collaterals only', exact: true })
            .click();
        await expect(page.locator('.exp-row').first()).toBeVisible({
            timeout: 30000,
        });
        await page.screenshot({
            path: 'e2e/.artifacts/collaterals-entry-only.png',
            fullPage: true,
        });
    });
});
