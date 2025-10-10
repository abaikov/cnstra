import { test, expect } from '@playwright/test';

test.describe('DevTools Exports', () => {
    test('downloads topology and snapshot JSON', async ({ page, context }) => {
        await page.goto('/');

        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        // Wait for buttons to be enabled
        const topoBtn = page.getByRole('button', {
            name: '⬇️ Download Topology JSON',
        });
        await expect(topoBtn).toBeEnabled();

        const [topologyDownload] = await Promise.all([
            page.waitForEvent('download'),
            topoBtn.click(),
        ]);
        const topoPath = await topologyDownload.path();
        expect(topoPath).toBeTruthy();

        // Select app if needed by clicking first one (optional step)
        // Then snapshot
        const snapshotBtn = page
            .getByRole('button', { name: '⬇️ Download Snapshot JSON' })
            .first();
        const [snapshotDownload] = await Promise.all([
            page.waitForEvent('download'),
            snapshotBtn.click(),
        ]);
        const snapPath = await snapshotDownload.path();
        expect(snapPath).toBeTruthy();
    });
});
