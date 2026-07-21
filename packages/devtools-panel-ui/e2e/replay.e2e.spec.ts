import { test, expect } from '@playwright/test';

// The replay-result banner and replay-history/prefetch UI were removed in the
// CNSDTO migration; only the per-item "▶️ Replay" action remains. This is a
// light smoke that it's present on real activity and clicking it doesn't break
// the view. (The replay's effect surfaces later as a "🔁 Replay" item.)
test.describe('Stimulations Replay', () => {
    test('a stimulation exposes a Replay action that can be clicked', async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        await page.getByRole('button', { name: '⚡ Stimulations' }).click();

        // Wait for real activity (the demo emits every few seconds).
        await expect(
            page.getByText(/Total (responses|stimulations): [1-9]/)
        ).toBeVisible({ timeout: 60000 });

        const replayBtn = page
            .getByRole('button', { name: '▶️ Replay' })
            .first();
        await expect(replayBtn).toBeVisible({ timeout: 60000 });
        await replayBtn.click();

        // Replaying must not break the view; the list still renders.
        await expect(
            page.getByText(/Total (responses|stimulations):/)
        ).toBeVisible();
    });
});
