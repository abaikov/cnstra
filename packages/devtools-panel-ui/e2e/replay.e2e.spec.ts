import { test, expect } from '@playwright/test';

// The legacy id-based "▶️ Replay" action was replaced by the name-based
// Retry (resume frontier) / Clone (fresh run from entry) actions on the
// Stimulation→Attempt→Task view (Phase 2b-2/2b-3). This smoke checks those
// actions are present on a real run and that invoking one doesn't break the view.
test.describe('Stimulations retry/clone actions', () => {
    test('a selected run exposes Retry and Clone, and acting does not break the view', async ({
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
        await expect(page.getByText(/backend: devtools/)).toBeVisible({
            timeout: 60000,
        });

        // The demo emits runs; the page auto-selects the latest → its actions show.
        const cloneBtn = page.getByRole('button', { name: /Clone/ });
        await expect(cloneBtn).toBeVisible({ timeout: 60000 });
        await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();

        // Clone a run — the view must keep rendering (backend line stays).
        await cloneBtn.click();
        await expect(page.getByText(/backend: devtools/)).toBeVisible();
    });
});
