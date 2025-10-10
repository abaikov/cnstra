import { test, expect } from '@playwright/test';

test.describe('CNStra DevTools Panel E2E', () => {
    test('connects to server, shows apps, displays stimulations/responses', async ({
        page,
    }) => {
        await page.goto('/');

        // Connection status
        await expect(page.getByText('CONNECTION STATUS')).toBeVisible();
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 30000,
        });

        // Connected apps list appears (may take a bit while demo warms up)
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 30000,
        });

        // Open Stimulations tab
        const stimBtn = page.getByRole('button', { name: '⚡ Stimulations' });
        await stimBtn.click();

        // Total counter becomes visible; allow both responses or stimulations
        await expect(
            page.getByText(/Total (responses|stimulations):/)
        ).toBeVisible({ timeout: 30000 });

        // If there is data, ensure the first item appears eventually
        // The demo app produces activity every 8-12s, so we wait generously
        const hasAnyItem = await page
            .locator('text=Showing stimulations')
            .or(page.locator('text=id: '))
            .first()
            .isVisible({ timeout: 30000 })
            .catch(() => false);
        expect(hasAnyItem).toBeTruthy();
    });
});
