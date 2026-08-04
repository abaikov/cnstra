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

        // Active nodes (stim > 0), in graph order.
        const activeNodeIds = (): Promise<string[]> =>
            page.evaluate(() => {
                const cy: any = (window as any).__cnsCy;
                if (!cy) return [] as string[];
                return cy
                    .nodes()
                    .toArray()
                    .filter((n: any) => Number(n.data('stim') || 0) > 0)
                    .map((n: any) => n.id() as string);
            });

        // Open a node's sidebar; returns its label (first line of the cy label).
        const openNode = async (id: string): Promise<string | null> => {
            const label = await page.evaluate(nodeId => {
                const cy: any = (window as any).__cnsCy;
                const n = cy?.getElementById(nodeId);
                if (!n || n.length === 0) return null;
                const l = String(n.data('label') || '').split('\n')[0];
                n.emit('tap');
                return l as string;
            }, id);
            await expect(page.locator('.neuron-details-panel')).toBeVisible({
                timeout: 10000,
            });
            return label;
        };

        const PAYLOAD_KEYS = ['userId', 'email', 'token', 'event', 'action'];
        const panelHasPayload = (txt: string): boolean =>
            PAYLOAD_KEYS.some(k => txt.includes(k));

        // The payloads this test asserts render in a neuron's dendrite (input)
        // response rows carrying an OUTPUT payload — i.e. a processing neuron that
        // both received and emitted (e.g. cartNeuron: addToCart → cartUpdated{userId}).
        // The live demo is non-deterministic, so poll every active neuron over a
        // deadline until one surfaces payload data.
        const deadline = Date.now() + 30000;
        let chosen:
            | { id: string; label: string | null; input: number; output: number; total: number }
            | null = null;
        while (Date.now() < deadline && !chosen) {
            const ids = await activeNodeIds();
            for (const id of ids) {
                const label = await openNode(id);
                const nums = await readPanelNumbers();
                const txt = await page
                    .locator('.neuron-details-panel')
                    .innerText();
                if (panelHasPayload(txt)) {
                    chosen = { id, label, ...nums };
                    break;
                }
            }
            if (!chosen) await page.waitForTimeout(1000);
        }

        // Hard gate: a payload-bearing processing neuron must surface (topology now
        // includes entry collaterals, so cart/order-style neurons show their inputs).
        expect(
            chosen,
            'no payload-bearing response surfaced within the deadline'
        ).not.toBeNull();
        const clickedNodeLabel = await openNode(chosen!.id);
        const { input, output, total } = await readPanelNumbers();

        if (clickedNodeLabel) {
            await expect(
                page.getByRole('heading', {
                    name: new RegExp(clickedNodeLabel),
                })
            ).toBeVisible();
        }

        const debug = await page.evaluate(
            () => (window as any).__neuronPanelDebug
        );
        console.log(
            '🔍 NeuronDetailsPanel debug:',
            JSON.stringify(debug, null, 2)
        );

        // Structural assertions (always required): the panel reflects real activity.
        expect(total).toBe(input + output);
        expect(total).toBeGreaterThan(0);

        const panelText = await page
            .locator('.neuron-details-panel')
            .innerText();
        expect(panelText).toContain('DENDRITES & RESPONSE HISTORY');

        // Payload assertion (hard): the selected neuron's dendrite rows show real
        // signal payloads, not empty objects.
        expect(panelHasPayload(panelText)).toBe(true);

        // Close via the ✕ button inside the sidebar panel
        const closeBtn = page
            .locator('.neuron-details-panel')
            .getByRole('button', { name: '✕' });
        await closeBtn.click();
        await expect(page.locator('.neuron-details-panel')).toBeHidden();
    });
});
