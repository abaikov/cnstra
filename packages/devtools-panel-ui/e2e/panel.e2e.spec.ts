import { test, expect } from '@playwright/test';

test.describe('CNStra DevTools Panel E2E', () => {
    test('connects to server, shows apps, displays the name-based Stimulations view', async ({
        page,
    }) => {
        await page.goto('/');

        // Connection status
        await expect(page.getByText('CONNECTION STATUS')).toBeVisible();
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });

        // Connected apps list appears (may take a bit while demo warms up)
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        // Open the Explorer — the single stimulation surface (bucket protocol),
        // fed live from the server's name-based store over the socket.
        await page.getByRole('button', { name: /Explorer/ }).click();

        // The roster header ("<n> runs") is always present; the demo emits runs.
        await expect(page.getByText(/\d+ runs/).first()).toBeVisible({
            timeout: 60000,
        });
    });
});
