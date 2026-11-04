import { test, expect } from '@playwright/test';

test.describe('Scheduled', () => {
    test('lists the queued jobs and the schedules, and shows what is scheduled at a collateral and at a neuron', async ({ page }) => {
        test.setTimeout(90000);
        await page.goto('/');

        await page.getByRole('button', { name: 'Scheduled', exact: true }).click({ timeout: 60000 });
        const rows = page.locator('.exp-row');
        await expect(rows.filter({ hasText: 'checkout-later' })).toBeVisible({ timeout: 60000 });
        await expect(rows.filter({ hasText: 'payment-later' })).toContainText('▸ into');
        await expect(rows.filter({ hasText: 'checkout-later' })).toContainText(/in (59m|60m|1h)/);
        await expect(rows.filter({ hasText: 'reminder-tomorrow' })).toContainText('in 1d');
        await expect(rows.filter({ hasText: 'payment-later' })).toContainText('paymentNeuron ◂ orderNeuron.processPayment');
        await expect(rows.filter({ hasText: 'reminder-tomorrow' })).toContainText('scheduled');
        await expect(page.getByText('⏱ sendNotification · 0 9 * * * UTC').first()).toBeVisible();
        await expect(page.getByPlaceholder('search stimulationId…')).toBeHidden();
        await page.screenshot({ path: 'e2e/.artifacts/scheduled-list.png', fullPage: true });
        await page.setViewportSize({ width: 1024, height: 720 });
        await expect(page.getByRole('button', { name: 'Scheduled', exact: true })).toBeInViewport();
        await page.screenshot({ path: 'e2e/.artifacts/scheduled-list-narrow.png', fullPage: true });
        await page.setViewportSize({ width: 1280, height: 720 });

        await rows.filter({ hasText: 'payment-later' }).click();
        const details = page.locator('.exp-act-row');
        await expect(details.filter({ hasText: 'payment-later' })).toBeVisible({ timeout: 30000 });
        await expect(details.filter({ hasText: 'checkout-later' })).toHaveCount(0);
        await details.filter({ hasText: 'payment-later' }).scrollIntoViewIfNeeded();
        await expect(details.filter({ hasText: 'payment-later' })).toBeInViewport();
        await page.screenshot({ path: 'e2e/.artifacts/scheduled-collateral.png', fullPage: true });

        await page.getByRole('button', { name: 'Neurons', exact: true }).click();
        await rows.filter({ hasText: 'paymentNeuron' }).first().click({ timeout: 60000 });
        await expect(details.filter({ hasText: 'payment-later' })).toBeVisible({ timeout: 30000 });
        await expect(details.filter({ hasText: 'reminder-tomorrow' })).toHaveCount(0);
        await details.filter({ hasText: 'payment-later' }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: 'e2e/.artifacts/scheduled-neuron.png', fullPage: true });
        await details.filter({ hasText: 'payment-later' }).getByTitle(/Raise priority/).click();
        await expect(page.locator('.exp-scheduled-feedback').first()).toContainText('payment-later priority 1');
        await expect(details.filter({ hasText: 'payment-later' }).getByTitle(/Raise priority/)).toHaveAttribute('title', /now 1/, { timeout: 10000 });

        await page.getByRole('button', { name: 'Scheduled', exact: true }).click();
        const later = rows.filter({ hasText: 'checkout-later' });
        await later.getByTitle(/Raise priority/).click();
        await expect(page.locator('.exp-scheduled-feedback')).toContainText('checkout-later priority');
        await expect(later).toContainText('prio');
        await rows.filter({ hasText: 'reminder-tomorrow' }).getByTitle('Run now').click();
        await expect(page.locator('.exp-scheduled-feedback')).toContainText('reminder-tomorrow moved to now');
        await expect(rows.filter({ hasText: 'reminder-tomorrow' })).toContainText('due', { timeout: 10000 });
        await expect(rows.filter({ hasText: 'reminder-tomorrow' }).getByTitle('Run now')).toBeHidden();
        await later.getByTitle('Cancel (press twice)').click();
        await expect(page.locator('.exp-scheduled-feedback')).toContainText('Press ✕ again to cancel checkout-later');
        await expect(later).toHaveCount(1);
        await later.getByTitle('Cancel (press twice)').click();
        await expect(rows.filter({ hasText: 'checkout-later' })).toHaveCount(0, { timeout: 10000 });
        await page.screenshot({ path: 'e2e/.artifacts/scheduled-commands.png', fullPage: true });

        await page.getByRole('button', { name: '+ Enqueue a job' }).click();
        const form = page.locator('.exp-launch-form');
        await form.locator('select[name="collateral"]').selectOption('sendNotification');
        await expect(form).toContainText('Sends a notification to a user');
        await form.getByRole('button', { name: 'Enqueue' }).click();
        await expect(page.locator('.exp-scheduled-feedback')).toContainText('"userId" is required');
        await form.locator('input[name="userId"]').fill('user-9');
        await form.locator('select[name="type"]').selectOption('digest');
        await form.locator('input[name="message"]').fill('Weekly digest');
        await form.getByRole('button', { name: 'Enqueue' }).click();
        await expect(page.locator('.exp-scheduled-feedback')).toContainText('Launched sendNotification-');
        await expect(rows.filter({ hasText: /sendNotification-[0-9a-f-]{36}/ })).toHaveCount(1, { timeout: 10000 });
        await page.screenshot({ path: 'e2e/.artifacts/scheduled-enqueue.png', fullPage: true });
    });
});
