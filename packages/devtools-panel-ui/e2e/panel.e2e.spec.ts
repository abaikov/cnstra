import { test, expect } from '@playwright/test';

test.describe('CNStra DevTools Panel E2E', () => {
    test('lands directly on the Explorer (no landing page, no nav click)', async ({
        page,
    }) => {
        await page.goto('/');

        // Identity/health is folded into the top bar — the brand is always present.
        await expect(page.getByText('🧠 CNStra')).toBeVisible();

        // The Explorer IS the landing surface: the facet rail (lens switch) and the
        // roster header ("<n> runs") are visible immediately, with NO extra click.
        await expect(
            page.getByRole('button', { name: 'Collaterals' })
        ).toBeVisible({ timeout: 60000 });
        await expect(page.getByText(/\d+ runs/).first()).toBeVisible({
            timeout: 60000,
        });
    });

    test('a bare reload lands back on the Explorer, not a topology/apps page', async ({
        page,
    }) => {
        await page.goto('/');
        await expect(
            page.getByRole('button', { name: 'Collaterals' })
        ).toBeVisible({ timeout: 60000 });

        // Reload the bare URL — the Explorer must come straight back up, no click.
        await page.reload();
        await expect(page.getByText('🧠 CNStra')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Collaterals' })
        ).toBeVisible({ timeout: 60000 });
        await expect(page.getByText(/\d+ runs/).first()).toBeVisible({
            timeout: 60000,
        });
    });
});
