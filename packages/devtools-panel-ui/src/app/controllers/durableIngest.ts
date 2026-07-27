import type { DevtoolsSocket } from './socket';
import { mainCNS } from '../../cns';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { db } from '../../model';
import type { TCNSDurableRunView } from '../../durable/TCNSDurableRunView';
import { translateRunView } from '../../durable/translateRunView';

/**
 * Name-based observability ingest (Phase 2b-4): the panel's SOLE stimulation/hop
 * data source. Polls the devtools-server's durable store (`cns.stimulations.query`
 * → run views), translates each run into the panel's id-shaped OIMDB entities via
 * {@link translateRunView}, and feeds them through the existing data-layer by
 * stimulating the domain collaterals (so the graph frontier / analytics / details /
 * performance views — which read `db.stimulations`/`db.responses` — need no change).
 *
 * This replaces the legacy per-hop id-based WS stream (`stimulation.started/hop/
 * completed`) entirely. Transport is pluggable (polling here; a push socket could
 * feed the same translate step) — see [[reference-devtools-transport-seam]].
 */
const POLL_MS = 2000;

const genId = (): string =>
    `runs-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** cnsId → appId, via the synthesized `db.cns` (falls back to any neuron's app). */
function appIdForCns(cnsId: string): string | undefined {
    const c = db.cns.getOneByPk(cnsId);
    if (c) return c.appId;
    for (const n of db.neurons.getAll()) if (n.cnsId === cnsId) return n.appId;
    return undefined;
}

/** Build a collateralName → topology id lookup for a cns (names unique per cns). */
function collateralIdByNameFor(cnsId: string): (name: string) => string | undefined {
    const map = new Map<string, string>();
    for (const col of db.collaterals.getAll()) {
        if (col.cnsId === cnsId) map.set(col.name, col.id);
    }
    return name => map.get(name);
}

function ingestRuns(runs: TCNSDurableRunView[]): void {
    for (const run of runs) {
        const cnsId = run.scopeName;
        if (!cnsId) continue;
        const appId = appIdForCns(cnsId);
        if (!appId) continue; // topology for this cns not received yet — next poll

        const { stimulation, hops } = translateRunView(run, {
            cnsId,
            appId,
            collateralIdByName: collateralIdByNameFor(cnsId),
        });

        mainCNS.stimulate(
            appModelAxon.stimulationStarted.createSignal(stimulation)
        );
        for (const hop of hops) {
            mainCNS.stimulate(appModelAxon.hopAdded.createSignal(hop));
        }
        if (stimulation.completedAt != null) {
            mainCNS.stimulate(
                appModelAxon.stimulationCompleted.createSignal({
                    stimulationId: stimulation.id,
                    completedAt: stimulation.completedAt,
                    hopCount: stimulation.hopCount,
                    hasError: stimulation.hasError,
                })
            );
        }
    }
}

export interface DurableIngest {
    dispose(): void;
}

export function createDurableIngest(socket: DevtoolsSocket): DurableIngest {
    let timer: ReturnType<typeof setInterval> | null = null;
    let onMsg: ((ev: MessageEvent) => void) | null = null;

    const poll = (): void => {
        const ws = socket.getSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const requestId = genId();

        // One-shot listener for this poll's reply.
        const listener = (ev: MessageEvent): void => {
            let m: any;
            try {
                m = JSON.parse(
                    typeof ev.data === 'string' ? ev.data : String(ev.data)
                );
            } catch {
                return;
            }
            if (m?.type !== 'cns.stimulations.result' || m.requestId !== requestId)
                return;
            ws.removeEventListener('message', listener);
            if (onMsg === listener) onMsg = null;
            ingestRuns(m.runs as TCNSDurableRunView[]);
        };
        // Drop any previous unanswered listener before installing a new one.
        if (onMsg) ws.removeEventListener('message', onMsg);
        onMsg = listener;
        ws.addEventListener('message', listener);

        // Query ALL scopes (the panel shows every app/cns).
        socket.send({ type: 'cns.stimulations.query', requestId } as never);
    };

    timer = setInterval(poll, POLL_MS);
    poll();

    return {
        dispose: () => {
            if (timer) clearInterval(timer);
            timer = null;
            const ws = socket.getSocket();
            if (ws && onMsg) ws.removeEventListener('message', onMsg);
            onMsg = null;
        },
    };
}
