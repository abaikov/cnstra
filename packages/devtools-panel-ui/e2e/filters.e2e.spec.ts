import { test, expect } from '@playwright/test';

test.describe('Stimulations Filters', () => {
    test('applies the "Only errors" filter without breaking the list', async ({
        page,
    }) => {
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        // Filters live in the sidebar now.
        await page.getByRole('checkbox', { name: 'Only errors' }).check();
        await page.getByRole('button', { name: 'Apply Filters' }).click();

        await page.getByRole('button', { name: '⚡ Stimulations' }).click();

        // The list re-renders under the filter — either matching items or the
        // empty-state — without crashing.
        await expect(
            page
                .getByText(/Total (responses|stimulations):/)
                .or(page.getByText('No Activity Detected'))
                .first()
        ).toBeVisible({ timeout: 60000 });
    });
});
