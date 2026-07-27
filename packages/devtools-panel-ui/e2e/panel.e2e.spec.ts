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

        // Open the Stimulations tab — now the name-based Stimulation→Attempt→Task
        // view, fed live from the server's durable store over the socket.
        await page.getByRole('button', { name: '⚡ Stimulations' }).click();

        // The page frame is present (unique backend line).
        await expect(page.getByText(/backend: devtools/)).toBeVisible({
            timeout: 60000,
        });

        // The demo emits stimulations every few seconds. Accept either a real run
        // (its Clone action surfaces once a run is auto-selected) or the empty state.
        await expect(
            page
                .getByText('no runs yet')
                .or(page.getByRole('button', { name: /Clone/ }))
                .first()
        ).toBeVisible({ timeout: 60000 });
    });
});
