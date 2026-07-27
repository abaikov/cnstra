import { test, expect } from '@playwright/test';

// Full-stack check of the live frontier: feeds a topology + a *running*,
// name-based run snapshot (the panel's new poll protocol) through a faked
// WebSocket and asserts the stalled subscriber node reaches cytoscape
// `data('frontier') === 3` (stuck).
//
// The panel no longer ingests the legacy per-hop WS stream
// (`stimulation.started/hop/completed`). Instead `durableIngest` polls the
// server every 2s with `{ type: 'cns.stimulations.query', requestId }` and
// expects `{ type: 'cns.stimulations.result', requestId, runs }`, translating
// each `TCNSDurableRunView` into `db.stimulations`/`db.responses` via
// `translateRunView`. So here the fake WS answers that query with ONE running
// run whose single task (neuron `api`, output collateral `request`, an OLD
// startedAt) points — via the `worker` dendrite — at `worker`, which has not
// run and therefore ages into a "stuck" frontier.
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
 *
 * `send()` intercepts the ingest's `cns.stimulations.query` and replies with a
 * `cns.stimulations.result` built from `window.__cnsRuns` (set by the test once
 * the topology has landed), echoing the query's `requestId` so the poll matches
 * it. All other outgoing frames (client.connect / apps.query / topology.query)
 * are ignored; topology is delivered out-of-band via `emit()`.
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
        send(data?: string) {
            // Answer the durable-ingest poll from the test-provided run fixture.
            let m: any;
            try {
                m = JSON.parse(String(data));
            } catch {
                return; // client.connect / apps.query / topology.query — ignore
            }
            if (m && m.type === 'cns.stimulations.query') {
                const runs = (window as any).__cnsRuns || [];
                const reply = {
                    type: 'cns.stimulations.result',
                    requestId: m.requestId,
                    runs,
                };
                setTimeout(() => this.emit(JSON.stringify(reply)), 0);
            }
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

    // One *running* name-based run snapshot (the poll reply). `scopeName` MUST be
    // the cnsId so translateRunView reconstructs ids against the topology above,
    // and status 'running' makes the stimulation in-flight (completedAt: null) —
    // required for a live frontier. The single task: neuron `api` outputs the
    // `request` collateral, which `worker` subscribes to (dendrite) but never
    // runs — so `worker` is the frontier node. Its `startedAt` is 10s in the past
    // so the frontier ages straight to "stuck" on the next poll tick.
    const run = {
        runId: 'run-1',
        status: 'running',
        scopeName: CNS_ID,
        entry: { collateralName: 'request', payload: { n: 1 } },
        frontier: ['worker'],
        attempts: [
            {
                attemptNumber: 1,
                status: 'running',
                hopCount: 1,
                startedAt: now - 10000,
                completedAt: null,
                tasks: [
                    {
                        index: 0,
                        neuronName: 'api',
                        dendriteCollateralName: 'request',
                        status: 'completed',
                        output: {
                            collateralName: 'request',
                            payload: { ok: true },
                        },
                        error: null,
                        startedAt: now - 10000,
                        duration: 2,
                    },
                ],
            },
        ],
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

    // Publish the run fixture the fake WS serves on the next `cns.stimulations.query`
    // poll (durableIngest polls every 2s; the assertion below waits it out).
    await page.evaluate(r => {
        (window as any).__cnsRuns = [r];
    }, run);

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
