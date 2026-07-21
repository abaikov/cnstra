import { test, expect } from '@playwright/test';

test.describe('CNStra DevTools Panel E2E', () => {
    test('connects to server, shows apps, displays stimulations/responses', async ({
        page,
    }) => {
        await page.goto('/');

        // Connection status
        await expect(page.getByText('CONNECTION STATUS')).toBeVisible();
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });

        // Connected apps list appears (may take a bit while demo warms up)
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        // Open Stimulations tab
        const stimBtn = page.getByRole('button', { name: '⚡ Stimulations' });
        await stimBtn.click();

        // Total counter becomes visible; allow both responses or stimulations
        await expect(
            page.getByText(/Total (responses|stimulations):/)
        ).toBeVisible({ timeout: 60000 });

        // The demo emits activity every few seconds. Accept either real items
        // (a non-zero total) or the empty-state placeholder.
        await expect(
            page
                .getByText(/Total (responses|stimulations): [1-9]/)
                .or(page.getByText('No Activity Detected'))
                .first()
        ).toBeVisible({ timeout: 60000 });
    });
});
