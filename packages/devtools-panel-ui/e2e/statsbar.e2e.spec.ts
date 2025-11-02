import { test, expect } from '@playwright/test';

test.describe('Stats bar numbers', () => {
    test('shows neurons/connections counts matching graph elements', async ({
        page,
    }) => {
        await page.goto('/');

        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        await expect(page.locator('.cns-graph')).toBeVisible({
            timeout: 60000,
        });

        // Read counts from the sticky stats bar
        const statsBar = page.locator('text=🗺️ Network Map').locator('..');
        await expect(statsBar).toBeVisible();

        const statsText = await statsBar.innerText();
        const neuronsMatch = statsText.match(/🧠\s*(\d+)\s*neurons/);
        const connectionsMatch = statsText.match(/🔗\s*(\d+)\s*connections/);
        expect(neuronsMatch).not.toBeNull();
        expect(connectionsMatch).not.toBeNull();
        const neuronsCount = Number(neuronsMatch![1]);
        const connectionsCount = Number(connectionsMatch![1]);

        // Compare with actual Cytoscape counts
        const graphCounts = await page.evaluate(() => {
            const cy: any = (window as any).__cnsCy;
            if (!cy) return { nodes: -1, edges: -1 };
            return { nodes: cy.nodes().length, edges: cy.edges().length };
        });

        expect(graphCounts.nodes).toBe(neuronsCount);
        expect(graphCounts.edges).toBe(connectionsCount);
    });
});
