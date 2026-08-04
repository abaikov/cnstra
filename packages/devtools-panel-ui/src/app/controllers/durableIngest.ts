import type { DevtoolsSocket } from './socket';
import { mainCNS } from '../../cns';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { db } from '../../model';
import type { TCNSStimulationState, TCNSHopState } from '../../model';
import type { TCNSStimulationViewDTO } from '@cnstra/devtools-dto';

/**
 * Name-based observability ingest: the panel's SOLE stimulation/hop data source.
 * Polls the devtools-server's durable store (`cns.stimulations.query` → run views)
 * and stores each view by NAME — a `TCNSStimulationState` header + flat
 * `TCNSHopState` rows (the backend task shape, stored once) — via the domain
 * collaterals. No id is synthesized from names: the entry/hops keep collateral &
 * neuron NAMES; the graph resolves those to topology nodes at render.
 *
 * This replaces the legacy per-hop id-based WS stream (`stimulation.started/hop/
 * completed`) entirely. Transport is pluggable (polling here; a push socket could
 * feed the same store step) — see [[reference-devtools-transport-seam]].
 */
const POLL_MS = 2000;

const genId = (): string =>
    `stimulations-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** cnsId → appId, via the synthesized `db.cns` (falls back to any neuron's app). */
function appIdForCns(cnsId: string): string | undefined {
    const c = db.cns.getOneByPk(cnsId);
    if (c) return c.appId;
    for (const n of db.neurons.getAll()) if (n.cnsId === cnsId) return n.appId;
    return undefined;
}

/** Flatten one name-based view into a header + its flat name-based hop rows. */
export function projectView(
    view: TCNSStimulationViewDTO,
    cnsId: string,
    appId: string
): { stimulation: TCNSStimulationState; hops: TCNSHopState[] } {
    const firstAttempt = view.attempts[0];
    const lastAttempt = view.attempts[view.attempts.length - 1];
    const startedAt = firstAttempt?.startedAt ?? 0;
    const completedAt =
        view.status === 'running' ? null : lastAttempt?.completedAt ?? null;
    const hopCount = view.attempts.reduce((n, a) => n + a.tasks.length, 0);

    const stimulation: TCNSStimulationState = {
        stimulationId: view.stimulationId,
        scopeName: cnsId,
        appId,
        entry: view.entry,
        status: view.status,
        frontier: view.frontier,
        startedAt,
        completedAt,
        hopCount,
        hasError: view.status === 'failed',
    };

    const hops: TCNSHopState[] = [];
    for (const a of view.attempts) {
        for (const t of a.tasks) {
            hops.push({
                ...t,
                // Surrogate row key from real ids/indices — NOT derived from a name.
                id: `${view.stimulationId}#${a.attemptNumber}:${t.index}`,
                stimulationId: view.stimulationId,
                attemptNumber: a.attemptNumber,
                appId,
                scopeName: cnsId,
                startedAt: t.startedAt ?? startedAt,
            });
        }
    }
    return { stimulation, hops };
}

function ingestStimulations(views: TCNSStimulationViewDTO[]): void {
    for (const view of views) {
        const cnsId = view.scopeName;
        if (!cnsId) continue;
        const appId = appIdForCns(cnsId);
        if (!appId) continue; // topology for this cns not received yet — next poll

        const { stimulation, hops } = projectView(view, cnsId, appId);

        mainCNS.stimulate(
            appModelAxon.stimulationStarted.createSignal(stimulation)
        );
        for (const hop of hops) {
            mainCNS.stimulate(appModelAxon.hopAdded.createSignal(hop));
        }
        if (stimulation.completedAt != null) {
            mainCNS.stimulate(
                appModelAxon.stimulationCompleted.createSignal({
                    stimulationId: stimulation.stimulationId,
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
            ingestStimulations(m.stimulations as TCNSStimulationViewDTO[]);
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
