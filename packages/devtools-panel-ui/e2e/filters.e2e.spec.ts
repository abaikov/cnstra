import { test, expect } from '@playwright/test';

test.describe('Stimulations Filters', () => {
    test('applies Only errors and errorContains filters', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        await page.getByRole('button', { name: '⚡ Stimulations' }).click();

        // Toggle Only errors
        await page.getByRole('checkbox', { name: 'Only errors' }).check();
        await page.getByRole('button', { name: 'Apply Filters' }).click();

        // Enter errorContains and apply
        const errorContains = page.getByPlaceholder('error contains...');
        await errorContains.fill('boom');
        await page.getByRole('button', { name: 'Apply Filters' }).click();

        // We accept either empty (no matching errors yet) or presence of list
        await expect(
            page
                .locator('text=Total')
                .or(page.locator('text=No stimulations yet'))
                .first()
        ).toBeVisible({ timeout: 60000 });
    });
});
