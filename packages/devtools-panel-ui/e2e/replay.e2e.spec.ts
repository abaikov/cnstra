import { test, expect } from '@playwright/test';

// The name-based Retry (resume frontier) / Clone (fresh run from entry) actions
// live on the Explorer's waterfall (a selected run). This smoke checks those
// actions are present on a real run and that invoking one doesn't break the view.
test.describe('Explorer retry/clone actions', () => {
    test('a selected run exposes Retry and Clone, and acting does not break the view', async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });

        await page.getByRole('button', { name: /Explorer/ }).click();

        // The demo emits runs; click the newest roster row → the waterfall opens.
        const firstRow = page.locator('.exp-row').first();
        await expect(firstRow).toBeVisible({ timeout: 60000 });
        await firstRow.click();

        // The waterfall exposes Retry + Clone for the selected run.
        const cloneBtn = page.getByRole('button', { name: 'Clone', exact: true });
        await expect(cloneBtn).toBeVisible({ timeout: 60000 });
        await expect(
            page.getByRole('button', { name: 'Retry', exact: true })
        ).toBeVisible();

        // Clone a run — the view must keep rendering (Runs switch stays).
        await cloneBtn.click();
        await expect(
            page.getByRole('button', { name: 'Runs', exact: true })
        ).toBeVisible();
    });
});
