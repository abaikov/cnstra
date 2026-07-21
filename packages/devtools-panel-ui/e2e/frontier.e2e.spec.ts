import { test, expect } from '@playwright/test';

// Full-stack check of the live frontier: feeds a topology + a *running*
// stimulation + a single stalled hop through a faked WebSocket and asserts the
// stalled subscriber node reaches cytoscape `data('frontier') === 3` (stuck).
//
// Requires the shared e2e harness (playwright.global-setup boots example-app on
// :8080 to serve the panel). The pure selection/severity logic is also covered,
// harness-free, in src/ui/__tests__/frontier.test.ts.

// ── Deterministic topology (mirrors the integration-test shapes) ──────────────
const APP = 'stuck-app';
const CNS_ID = 'stuck-app:main';
const N_API = `${CNS_ID}:api`;
const N_WORKER = `${CNS_ID}:worker`;
const C_REQUEST = `${CNS_ID}:api:request`; // owned by api, subscribed by worker
const C_DONE = `${CNS_ID}:worker:done`;

/**
 * Replace window.WebSocket with a fake the test drives, so we can feed exact
 * frames into the panel instead of relying on the live example-app server.
 * Runs in the browser before app scripts load.
 */
function installFakeWebSocket() {
    class FakeWS {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 0;
        url: string;
        private listeners: Record<string, Array<(ev: any) => void>> = {
            open: [],
            message: [],
            close: [],
            error: [],
        };
        constructor(url: string) {
            this.url = url;
            (window as any).__mockWs = this;
            setTimeout(() => {
                this.readyState = 1;
                this.fire('open', {});
            }, 0);
        }
        addEventListener(type: string, cb: (ev: any) => void) {
            (this.listeners[type] ||= []).push(cb);
        }
        removeEventListener(type: string, cb: (ev: any) => void) {
            const a = this.listeners[type];
            if (!a) return;
            const i = a.indexOf(cb);
            if (i >= 0) a.splice(i, 1);
        }
        send() {
            /* ignore client.connect / apps.query / topology.query */
        }
        close() {
            this.readyState = 3;
            this.fire('close', { code: 1000, reason: '' });
        }
        private fire(type: string, ev: any) {
            (this.listeners[type] || []).forEach(cb => {
                try {
                    cb(ev);
                } catch {
                    /* noop */
                }
            });
        }
        // Test hook: deliver a server frame to the panel.
        emit(data: string) {
            this.fire('message', { data });
        }
    }
    (window as any).WebSocket = FakeWS as any;
    (window as any).__CNSTRA_DEVTOOLS_WS__ = 'ws://mock';
}

test('a stalled hop makes its subscriber neuron turn "stuck" (frontier = 3)', async ({
    page,
}) => {
    await page.addInitScript(installFakeWebSocket);
    await page.goto('/');

    // Wait for the faked socket to "open".
    await page.waitForFunction(
        () => (window as any).__mockWs && (window as any).__mockWs.readyState === 1
    );

    const now = Date.now();

    const appConnected = {
        type: 'app.connected',
        app: {
            id: APP,
            name: 'Stuck App',
            version: '1.0.0',
            connectedAt: now,
            lastSeenAt: now,
        },
        topology: {
            cnsId: CNS_ID,
            neurons: [
                { id: N_API, name: 'api', cnsId: CNS_ID, appId: APP },
                { id: N_WORKER, name: 'worker', cnsId: CNS_ID, appId: APP },
            ],
            collaterals: [
                {
                    id: C_REQUEST,
                    name: 'request',
                    neuronId: N_API,
                    cnsId: CNS_ID,
                    appId: APP,
                },
                {
                    id: C_DONE,
                    name: 'done',
                    neuronId: N_WORKER,
                    cnsId: CNS_ID,
                    appId: APP,
                },
            ],
            dendrites: [
                {
                    id: `${CNS_ID}:worker:d:request`,
                    neuronId: N_WORKER,
                    collateralId: C_REQUEST,
                    cnsId: CNS_ID,
                    appId: APP,
                },
            ],
        },
    };

    // Running stimulation (completedAt: null) — required for a live frontier.
    const started = {
        type: 'stimulation.started',
        stimulation: {
            id: 'stim-1',
            cnsId: CNS_ID,
            appId: APP,
            collateralId: C_REQUEST,
            payload: { n: 1 },
            startedAt: now,
            completedAt: null,
            hopCount: 0,
            hasError: false,
            replayOf: null,
        },
    };

    // api emitted `request`; worker subscribes to it but never hops. startedAt is
    // 5s in the past so the frontier ages straight to "stuck" on the next tick.
    const hop = {
        type: 'stimulation.hop',
        hop: {
            id: 'stim-1:0',
            stimulationId: 'stim-1',
            index: 0,
            neuronId: N_API,
            inputCollateralId: C_REQUEST,
            outputCollateralId: C_REQUEST,
            inputPayload: { n: 1 },
            outputPayload: { ok: true },
            startedAt: now - 5000,
            duration: 2,
            error: null,
        },
    };

    const emit = (frame: unknown) =>
        page.evaluate(
            f => (window as any).__mockWs.emit(JSON.stringify(f)),
            frame
        );

    await emit(appConnected);
    // App auto-selects and TopologyView renders the graph.
    await page.locator('.cns-graph').waitFor({ state: 'visible' });
    await page.waitForFunction(() => Boolean((window as any).__cnsCy));

    await emit(started);
    await page.waitForTimeout(150); // let the stimulation land so the hop resolves its appId
    await emit(hop);

    const frontierOf = (id: string) =>
        page.evaluate(nid => {
            const cy = (window as any).__cnsCy;
            if (!cy) return -1;
            const el = cy.getElementById(nid);
            if (!el || el.empty()) return -2;
            return Number(el.data('frontier') ?? 0);
        }, id);

    // worker is the frontier node and, being stalled, must reach severity 3.
    await expect
        .poll(() => frontierOf(N_WORKER), {
            timeout: 15000,
            intervals: [300],
        })
        .toBe(3);

    // The producer (api) actually ran, so it must NOT be marked as frontier.
    expect(await frontierOf(N_API)).toBe(0);
});
