import { test, expect, type Page } from '@playwright/test';

const openCollateral = async (page: Page, name: string) => {
    await page.getByRole('button', { name: 'Collaterals', exact: true }).click();
    const row = page.locator('.collateral-row', { has: page.locator('.row-title', { hasText: new RegExp(`^${name.replace(/[.]/g, '\\.')}$`) }) });
    await expect(row).toBeVisible({ timeout: 60000 });
    await row.click();
    await expect(page.locator('.exp-scope-card-title', { hasText: new RegExp(`^${name.replace(/[.]/g, '\\.')}$`) })).toBeVisible({ timeout: 60000 });
};

const diagramOf = (page: Page) => page.locator('.exp-scope-card-diagram svg.dg-svg');

const subscriberNodesOf = (page: Page) => diagramOf(page).locator(':scope > g:nth-of-type(2) .dg-link');

const expectNodesInsideDiagram = async (page: Page) => {
    const svgBox = await diagramOf(page).boundingBox();
    expect(svgBox).not.toBeNull();
    if (svgBox === null) return;
    const nodes = diagramOf(page).locator('.dg-link .dg-node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
        const box = await nodes.nth(index).boundingBox();
        expect(box).not.toBeNull();
        if (box === null) continue;
        expect(box.x).toBeGreaterThanOrEqual(svgBox.x - 1);
        expect(box.y).toBeGreaterThanOrEqual(svgBox.y - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(svgBox.y + svgBox.height + 1);
    }
};

test.describe('Node-link diagram paging', () => {
    test('a side with more than 8 nodes pages in a circle; 8 or fewer shows no arrows', async ({ page }) => {
        test.setTimeout(180000);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto('/?transport=demo');
        await expect(page.locator('.exp-row').first()).toBeVisible({ timeout: 60000 });

        await openCollateral(page, 'delivery.orderDelivered');
        const pager = diagramOf(page).locator('.dg-pager[data-side="right"]');
        const label = pager.locator('.dg-page-label');
        const previous = pager.getByRole('button', { name: 'Previous page' });
        const next = pager.getByRole('button', { name: 'Next page' });

        await expect(subscriberNodesOf(page)).toHaveCount(8);
        await expect(label).toHaveText('1–8 of 12');
        await expect(next).toBeVisible();
        await expect(next).not.toHaveAttribute('aria-disabled', 'true');
        await expect(diagramOf(page).locator('.dg-pager[data-side="left"]')).toBeHidden();
        await expectNodesInsideDiagram(page);
        const firstPageHeight = await diagramOf(page).getAttribute('height');
        await page.screenshot({ path: 'e2e/.artifacts/diagram-paging-1280.png', fullPage: true });

        await next.click();
        await expect(subscriberNodesOf(page)).toHaveCount(4);
        await expect(label).toHaveText('9–12 of 12');
        expect(await diagramOf(page).getAttribute('height')).toBe(firstPageHeight);
        await expectNodesInsideDiagram(page);

        await next.click();
        await expect(label).toHaveText('1–8 of 12');
        await expect(subscriberNodesOf(page)).toHaveCount(8);

        await previous.focus();
        await page.keyboard.press('Enter');
        await expect(label).toHaveText('9–12 of 12');
        await expect(subscriberNodesOf(page)).toHaveCount(4);

        await page.setViewportSize({ width: 800, height: 900 });
        await expectNodesInsideDiagram(page);
        await page.screenshot({ path: 'e2e/.artifacts/diagram-paging-800.png', fullPage: true });

        await page.setViewportSize({ width: 1280, height: 900 });
        await openCollateral(page, 'reviews.reviewReceived');
        await expect(subscriberNodesOf(page)).toHaveCount(5);
        await expect(diagramOf(page).getByRole('button', { name: 'Next page' })).toHaveCount(0);
        await expect(diagramOf(page).getByRole('button', { name: 'Previous page' })).toHaveCount(0);
        await expectNodesInsideDiagram(page);
        await page.screenshot({ path: 'e2e/.artifacts/diagram-no-paging-1280.png', fullPage: true });
    });
});
