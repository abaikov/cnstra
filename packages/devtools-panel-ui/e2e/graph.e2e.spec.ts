import { test, expect } from '@playwright/test';

test.describe('Network Graph and Stimulations Flow', () => {
    test('renders graph with neurons and shows stimulations count > 0 after activity', async ({
        page,
    }) => {
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        // Graph tab is default; ensure topology stats bar appears
        await expect(page.getByText(/neurons/)).toBeVisible({ timeout: 60000 });
        await expect(page.getByText(/connections/)).toBeVisible({
            timeout: 60000,
        });

        // Wait up to ~10s for stimulations to increase (should be fast; else it's a bug)
        const stimStat = page.getByText(/stimulations/);
        await expect(stimStat).toBeVisible({ timeout: 60000 });
        const started = Date.now();
        let count = 0;
        while (Date.now() - started < 10000) {
            const txt = (await stimStat.textContent()) || '';
            const m = txt.match(/(\d+)\s+stimulations/);
            count = m ? Number(m[1] || '0') : 0;
            if (count > 0) break;
            await page.waitForTimeout(1000);
        }
        expect(count).toBeGreaterThan(0);
        await expect(page.getByText(/neurons/)).toBeVisible();
    });
});
