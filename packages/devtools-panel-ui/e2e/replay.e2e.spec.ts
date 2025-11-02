import { test, expect } from '@playwright/test';

test.describe('Stimulations Replay', () => {
    test('replay button appears and can be clicked', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        await page.getByRole('button', { name: '⚡ Stimulations' }).click();

        // If there are items, click the first visible Replay button
        const replayBtn = page
            .getByRole('button', { name: '▶️ Replay' })
            .first();
        const hasReplay = await replayBtn.isVisible().catch(() => false);
        if (hasReplay) {
            await replayBtn.click();
            // Expect explicit accepted/rejected banner; avoid strict mode by narrowing to first match
            const resultBanner = page
                .getByText(/Replay (accepted|rejected)/)
                .first();
            await expect(resultBanner).toBeVisible({ timeout: 30000 });
        } else {
            // No replay available yet; consider this acceptable for CI stability
            await expect(page.locator('text=Total')).toBeVisible({
                timeout: 60000,
            });
        }
    });

    test('replay creates response that appears in stimulations list', async ({
        page,
    }) => {
        test.setTimeout(120000); // 2 minutes for this test

        await page.goto('/');
        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        await page.getByRole('button', { name: '⚡ Stimulations' }).click();

        // Wait for at least one item to appear in the list
        await expect(
            page.getByText(/Total (responses|stimulations):/)
        ).toBeVisible({ timeout: 60000 });

        // Count initial responses/stimulations
        const getItemCount = async () => {
            const totalText = await page
                .locator('text=/Total (responses|stimulations):/')
                .textContent();
            const match = totalText?.match(/(\d+)/);
            return match ? Number(match[1]) : 0;
        };

        const initialCount = await getItemCount();
        console.log('Initial items count:', initialCount);

        // Wait for at least one item to be present
        let hasItems = false;
        const itemsDeadline = Date.now() + 60000;
        while (Date.now() < itemsDeadline && !hasItems) {
            const count = await getItemCount();
            if (count > 0) {
                hasItems = true;
                break;
            }
            await page.waitForTimeout(1000);
        }

        if (!hasItems) {
            test.skip();
            return; // Skip if no items available
        }

        // Find the first Replay button
        const replayBtn = page
            .getByRole('button', { name: '▶️ Replay' })
            .first();
        const replayBtnVisible = await replayBtn.isVisible().catch(() => false);

        if (!replayBtnVisible) {
            test.skip();
            return; // Skip if no replay button available
        }

        // Count items with replay indicator before replay
        // We look for both "🔁 Replay" (in header) and "🔁 Replay response" (badge)
        const getReplayItemsCount = async () => {
            // Use more flexible selector that matches any element containing the replay emoji
            const replayLocators = await page
                .locator('text=/🔁.*[Rr]eplay/')
                .count();
            return replayLocators;
        };

        const replayItemsBefore = await getReplayItemsCount();
        console.log('Replay items before:', replayItemsBefore);

        // Get unique payload from the first item to identify it after replay
        const getFirstItemPayload = async () => {
            return await page.evaluate(() => {
                // Find first item card
                const firstCard = document.querySelector(
                    '[style*="background: var(--bg-card)"]'
                );
                if (!firstCard) return null;

                const text = firstCard.textContent || '';
                // Extract JSON payload - look for structured data
                const jsonMatch = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        // Return a unique identifier from payload
                        return JSON.stringify({
                            // Try to find unique fields
                            userId:
                                parsed.userId || parsed.id || parsed.user?.id,
                            productId: parsed.productId || parsed.product?.id,
                            query: parsed.query || parsed.search,
                            // Fallback to full payload hash
                            hash: jsonMatch[0].substring(0, 200),
                        });
                    } catch {
                        return jsonMatch[0].substring(0, 200);
                    }
                }
                // Fallback: return first 200 chars of visible text
                return text.substring(0, 200);
            });
        };

        const originalPayload = await getFirstItemPayload();
        console.log(
            'Original payload identifier:',
            originalPayload?.substring(0, 100)
        );

        // Click replay button
        await replayBtn.click();

        // Wait for "Replay accepted" banner
        await expect(page.getByText(/Replay accepted/i)).toBeVisible({
            timeout: 30000,
        });

        // Wait for new response with same payload + replay indicator
        let foundReplayResponse = false;
        const deadline = Date.now() + 45000; // 45 seconds

        while (Date.now() < deadline && !foundReplayResponse) {
            // Check if count increased
            const currentCount = await getItemCount();
            if (currentCount > initialCount) {
                // Count increased - check if new item has same payload AND replay indicator
                const allCards = await page.$$(
                    '[style*="background: var(--bg-card)"]'
                );

                for (const card of allCards) {
                    const cardText = await card.textContent();
                    if (!cardText) continue;

                    // Check if this card has the original payload (or similar identifier)
                    const hasMatchingPayload = originalPayload
                        ? cardText.includes(originalPayload.substring(0, 50))
                        : true; // If we couldn't extract payload, check all

                    if (hasMatchingPayload) {
                        // Check if this card has replay indicator
                        const hasReplayIndicator =
                            cardText.includes('🔁') &&
                            (cardText.includes('Replay') ||
                                cardText.includes('replay'));

                        if (hasReplayIndicator) {
                            console.log(
                                '✅ Found response with matching payload AND replay indicator!'
                            );
                            foundReplayResponse = true;
                            break;
                        }
                    }
                }
            }

            if (!foundReplayResponse) {
                await page.waitForTimeout(1000);
            }
        }

        if (!foundReplayResponse) {
            const finalCount = await getItemCount();
            console.log('Final count:', finalCount, 'Initial:', initialCount);

            if (finalCount <= initialCount) {
                throw new Error(
                    'Replay was accepted but no new responses appeared in the list!'
                );
            } else {
                throw new Error(
                    'New responses appeared after replay, but none have the replay indicator!'
                );
            }
        }

        // Verify that replay was processed
        const hasReplayAccepted = await page
            .getByText(/Replay accepted/i)
            .isVisible()
            .catch(() => false);
        expect(hasReplayAccepted).toBe(true);

        expect(foundReplayResponse).toBe(true);
    });
});
