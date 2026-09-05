import { test, expect } from '@playwright/test';

test.describe('CNStra DevTools Panel E2E', () => {
    test('lands directly on the Explorer dashboard (no landing page, no nav click)', async ({
        page,
    }) => {
        await page.goto('/');

        // Identity/health is folded into the FILTERS zone — the brand is always present.
        await expect(page.getByText('🧠 CNStra')).toBeVisible({ timeout: 60000 });

        // The four view tabs are the primary nav, visible immediately with NO click.
        await expect(
            page.getByRole('button', { name: 'Stimulations', exact: true })
        ).toBeVisible({ timeout: 60000 });
        await expect(
            page.getByRole('button', { name: 'Neurons', exact: true })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Activation tasks', exact: true })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Collaterals', exact: true })
        ).toBeVisible();
    });

    test('a bare reload lands back on the Explorer dashboard', async ({ page }) => {
        await page.goto('/');
        await expect(
            page.getByRole('button', { name: 'Stimulations', exact: true })
        ).toBeVisible({ timeout: 60000 });

        await page.reload();
        await expect(page.getByText('🧠 CNStra')).toBeVisible({ timeout: 60000 });
        await expect(
            page.getByRole('button', { name: 'Stimulations', exact: true })
        ).toBeVisible({ timeout: 60000 });
    });
});
