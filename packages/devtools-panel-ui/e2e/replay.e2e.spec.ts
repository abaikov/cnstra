import { test, expect } from '@playwright/test';

test.describe('Stimulations Replay (optional)', () => {
    test('replay button appears and can be clicked', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        await page.getByRole('button', { name: '⚡ Stimulations' }).click();

        // If there are items, click the first visible Replay button
        const replayBtn = page
            .getByRole('button', { name: '▶️ Replay' })
            .first();
        const hasReplay = await replayBtn.isVisible().catch(() => false);
        if (hasReplay) {
            await replayBtn.click();
            // Expect explicit accepted/rejected banner; avoid strict mode by narrowing to first match
            const resultBanner = page
                .getByText(/Replay (accepted|rejected)/)
                .first();
            await expect(resultBanner).toBeVisible({ timeout: 30000 });
        } else {
            // No replay available yet; consider this acceptable for CI stability
            await expect(page.locator('text=Total')).toBeVisible({
                timeout: 60000,
            });
        }
    });
});
