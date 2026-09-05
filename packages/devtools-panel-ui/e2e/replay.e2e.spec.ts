import { test, expect } from '@playwright/test';

// The name-based Retry (resume frontier) / Clone (fresh run from entry) actions
// live on the Stimulation DETAILS scope-card (the pipeline), which opens in the
// split-view when a stimulation row is selected. This smoke checks those actions
// are present on a real run and that Clone gives clear visible feedback.
test.describe('Explorer retry/clone actions', () => {
    test('a selected stimulation exposes Retry and Clone, and Clone shows a toast', async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.goto('/');

        // Stimulations is the default tab — click the newest row → details fill beside it.
        const firstRow = page.locator('.exp-row').first();
        await expect(firstRow).toBeVisible({ timeout: 60000 });
        await firstRow.click();

        // The stimulation pipeline exposes Retry + Clone for the selected run.
        const cloneBtn = page.getByRole('button', { name: 'Clone', exact: true });
        await expect(cloneBtn).toBeVisible({ timeout: 60000 });
        await expect(
            page.getByRole('button', { name: 'Retry', exact: true })
        ).toBeVisible();

        // Clone a run — a clear success toast must appear naming the new run, and the
        // dashboard keeps working (the renamed Stimulations tab stays present).
        await cloneBtn.click();
        await expect(page.locator('.exp-toast')).toContainText(/Cloned → new run/, {
            timeout: 60000,
        });
        await expect(
            page.getByRole('button', { name: 'Stimulations', exact: true })
        ).toBeVisible();
    });
});
