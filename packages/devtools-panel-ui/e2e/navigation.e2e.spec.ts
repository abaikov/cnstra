import { test, expect } from '@playwright/test';

// Verifies the node-link diagram's neuron/collateral distinction + labels, the
// clickable cross-navigation, and the DETAILS breadcrumb / back stack. Drills
// neuron → collateral → neuron and confirms the trail is reversible.
test.describe('Diagram distinction + breadcrumb navigation', () => {
    test('neuron/collateral nodes are labeled and drilling is reversible', async ({
        page,
    }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
        await page.waitForTimeout(2000);

        // Open a neuron from the list.
        await page.getByRole('button', { name: 'Neurons', exact: true }).click();
        await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });
        await page.locator('.exp-row').first().click();
        await expect(page.getByText(/NEURON · SCOPE/)).toBeVisible({ timeout: 60000 });

        // The diagram labels both kinds: `▪ NEURON` (center) + `◦ COLLATERAL` (sides).
        await page.locator('svg').last().scrollIntoViewIfNeeded();
        await expect(page.locator('svg text', { hasText: '▪ NEURON' }).first()).toBeVisible();
        await expect(page.locator('svg text', { hasText: '◦ COLLATERAL' }).first()).toBeVisible();
        await page.screenshot({ path: 'e2e/.artifacts/nav-neuron-diagram.png', fullPage: true });

        // Drill: click a COLLATERAL node (a clickable side node) → collateral detail.
        await page.locator('.dg-click').first().click();
        await expect(page.getByText(/COLLATERAL · (SCOPE|ENTRY)/)).toBeVisible({ timeout: 60000 });
        // Breadcrumb now has a back button + 2 crumbs.
        await expect(page.getByRole('button', { name: '← back' })).toBeVisible();

        // Drill again: click a NEURON node inside the collateral detail → neuron detail.
        await page.locator('svg').last().scrollIntoViewIfNeeded();
        await page.locator('.dg-click').first().click();
        await expect(page.getByText(/NEURON · SCOPE/)).toBeVisible({ timeout: 60000 });

        // Trail is 3 deep (neuron › collateral › neuron) — capture the breadcrumb.
        const crumbs = page.locator('.exp-crumb');
        expect(await crumbs.count()).toBeGreaterThanOrEqual(2); // 2 clickable + 1 current
        await expect(page.getByRole('button', { name: '← back' })).toBeVisible();
        await page.screenshot({ path: 'e2e/.artifacts/breadcrumb-drill.png', fullPage: true });

        // Back returns to the previous entity (the collateral).
        await page.getByRole('button', { name: '← back' }).click();
        await expect(page.getByText(/COLLATERAL · (SCOPE|ENTRY)/)).toBeVisible({ timeout: 30000 });
    });
});
