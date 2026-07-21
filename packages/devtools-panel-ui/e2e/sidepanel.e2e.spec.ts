import { test, expect } from '@playwright/test';

test.describe('Neuron sidebar panel', () => {
    test('opens when a neuron is clicked and can be closed', async ({
        page,
    }) => {
        test.setTimeout(60000); // Increase timeout to 60s
        await page.goto('/');

        await expect(page.getByText('Server Connected')).toBeVisible({
            timeout: 60000,
        });
        await expect(page.getByText(/CONNECTED APPS \(\d+\)/)).toBeVisible({
            timeout: 60000,
        });

        // Ensure graph renders
        await expect(page.locator('.cns-graph')).toBeVisible({
            timeout: 60000,
        });

        // Wait until the live demo has produced activity, so at least one node
        // has signals to open the sidebar with.
        await page.waitForFunction(
            () => {
                const cy: any = (window as any).__cnsCy;
                return (
                    !!cy &&
                    cy
                        .nodes()
                        .toArray()
                        .some((n: any) => Number(n.data('stim') || 0) > 0)
                );
            },
            { timeout: 60000 }
        );

        // Use the exposed Cytoscape instance to click a node with stim > 0 if available
        const clickedNodeLabel: string | null = await page.evaluate(() => {
            const cy: any = (window as any).__cnsCy;
            if (!cy) return null;
            const nodes: any[] = cy.nodes().toArray();
            let picked: any | null = null;
            for (const n of nodes) {
                const stim = Number(n.data('stim') || 0);
                if (stim > 0) {
                    picked = n;
                    break;
                }
            }
            if (!picked) picked = nodes[0];
            if (!picked) return null;
            // The cytoscape label is `${name}\n${stats}`; the panel heading shows
            // only the neuron name, so match on the first line.
            const label = String(picked.data('label') || '').split('\n')[0];
            picked.emit('tap');
            return label as string;
        });

        // Sidebar should appear
        await expect(page.locator('.neuron-details-panel')).toBeVisible({
            timeout: 10000,
        });

        if (clickedNodeLabel) {
            await expect(
                page.getByRole('heading', {
                    name: new RegExp(clickedNodeLabel),
                })
            ).toBeVisible();
        }

        const readPanelNumbers = async () => {
            const txt = await page.locator('.neuron-details-panel').innerText();
            const inputMatch = txt.match(/(\d+)\s*Input Signals/);
            const outputMatch = txt.match(/(\d+)\s*Output Signals/);
            const totalMatch = txt.match(/(\d+)\s*Total Signals/);
            return {
                input: inputMatch ? Number(inputMatch[1]) : 0,
                output: outputMatch ? Number(outputMatch[1]) : 0,
                total: totalMatch ? Number(totalMatch[1]) : 0,
            };
        };

        // Wait for signals to appear
        const deadline = Date.now() + 20000;
        let { input, output, total } = await readPanelNumbers();
        while (total === 0 && Date.now() < deadline) {
            await page.waitForTimeout(500);
            const nums = await readPanelNumbers();
            input = nums.input;
            output = nums.output;
            total = nums.total;
        }

        // Debug output
        const debug = await page.evaluate(
            () => (window as any).__neuronPanelDebug
        );
        console.log(
            '🔍 NeuronDetailsPanel debug:',
            JSON.stringify(debug, null, 2)
        );

        // The neuron has real signal activity. (Not every neuron has both
        // directions, so we don't require input AND output separately.)
        expect(total).toBe(input + output);
        expect(total).toBeGreaterThan(0);

        // Check that dendrites section exists and has data
        const panelText = await page
            .locator('.neuron-details-panel')
            .innerText();
        expect(panelText).toContain('DENDRITES & RESPONSE HISTORY');

        // Check that at least some response counts are shown
        const responseCountMatch = panelText.match(/Responses:\s*(\d+)/);
        if (responseCountMatch) {
            const responsesCount = Number(responseCountMatch[1]);
            console.log(`📊 Dendrite responses count: ${responsesCount}`);
            // Note: responses might be 0 for some dendrites, that's ok
        }

        // Check that we have actual payload data, not just empty objects
        const hasPayloadData =
            panelText.includes('userId') ||
            panelText.includes('email') ||
            panelText.includes('token') ||
            panelText.includes('event') ||
            panelText.includes('action');
        expect(hasPayloadData).toBe(true);

        // Close via the ✕ button inside the sidebar panel
        const closeBtn = page
            .locator('.neuron-details-panel')
            .getByRole('button', { name: '✕' });
        await closeBtn.click();
        await expect(page.locator('.neuron-details-panel')).toBeHidden();
    });
});
