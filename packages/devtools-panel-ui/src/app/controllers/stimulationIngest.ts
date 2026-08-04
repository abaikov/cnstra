import type { DevtoolsSocket } from './socket';
import { mainCNS } from '../../cns';
import { appModelAxon } from '../../cns/controller-layer/AppModelAxon';
import { db } from '../../model';
import type { TCNSStimulationState, TCNSHopState } from '../../model';
import type {
    TCNSStimulationRowDTO,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/devtools-dto';

/**
 * The panel's stimulation/hop data source for the topology + signal views. Polls
 * the devtools-server's FLAT-bucket snapshot (`cns.stimulations.snapshot` →
 * {stimulations, attempts, tasks}) and joins it client-side by id into
 * `db.stimulations` (headers) + `db.responses` (hops, one backend task each). No
 * server-side tree, no synthesized name-ids — entry/hops keep collateral & neuron
 * NAMES; the graph resolves those to topology nodes at render.
 *
 * (The bucket explorer — cns.stimulations.list/facets/detail — is the interactive
 * roster; this snapshot is the always-on aggregate feed those inspection views need.)
 */
const POLL_MS = 2000;
/** Newest-N runs pulled per poll — bounds the payload (dataLimiter caps storage too). */
const SNAPSHOT_LIMIT = 200;

const genId = (): string =>
    `stimulations-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** cnsId → appId, via the synthesized `db.cns` (falls back to any neuron's app). */
function appIdForCns(cnsId: string): string | undefined {
    const c = db.cns.getOneByPk(cnsId);
    if (c) return c.appId;
    for (const n of db.neurons.getAll()) if (n.cnsId === cnsId) return n.appId;
    return undefined;
}

interface TSnapshot {
    stimulations: TCNSStimulationRowDTO[];
    attempts: TCNSStimulationAttempt[];
    tasks: TCNSStimulationTask[];
}

export function ingestSnapshot(snap: TSnapshot): void {
    // attemptId → its run + attemptNumber (to attach each flat task to a stimulation).
    const attemptOwner = new Map<string, { stimulationId: string; attemptNumber: number }>();
    for (const a of snap.attempts)
        attemptOwner.set(a.stimulationAttemptId, {
            stimulationId: a.stimulationId,
            attemptNumber: a.attemptNumber,
        });

    // Group hops per run so we can emit them with their stimulation.
    const hopsByStim = new Map<string, TCNSHopState[]>();
    for (const t of snap.tasks) {
        const owner = attemptOwner.get(t.stimulationAttemptId);
        if (!owner) continue;
        const list = hopsByStim.get(owner.stimulationId) ?? [];
        list.push({
            index: t.index,
            neuronName: t.neuronName,
            dendriteCollateralName: t.dendriteCollateralName,
            status: t.status,
            output: t.output,
            error: t.error,
            duration: t.duration,
            id: `${owner.stimulationId}#${owner.attemptNumber}:${t.index}`,
            stimulationId: owner.stimulationId,
            attemptNumber: owner.attemptNumber,
            appId: '', // filled below once we resolve the run's app
            scopeName: '',
            startedAt: t.startedAt ?? 0,
        });
        hopsByStim.set(owner.stimulationId, list);
    }

    for (const row of snap.stimulations) {
        const cnsId = row.scopeName;
        if (!cnsId) continue;
        const appId = appIdForCns(cnsId);
        if (!appId) continue; // topology for this cns not received yet — next poll

        const stimulation: TCNSStimulationState = {
            stimulationId: row.stimulationId,
            scopeName: cnsId,
            appId,
            entry: row.entry,
            status: row.status,
            frontier: [], // survivors derive the frontier from hops, not this field
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            hopCount: row.hopCount,
            hasError: row.hasError,
        };
        mainCNS.stimulate(
            appModelAxon.stimulationStarted.createSignal(stimulation)
        );

        for (const hop of hopsByStim.get(row.stimulationId) ?? []) {
            hop.appId = appId;
            hop.scopeName = cnsId;
            if (!hop.startedAt) hop.startedAt = row.startedAt;
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

export interface StimulationIngest {
    dispose(): void;
}

export function createStimulationIngest(socket: DevtoolsSocket): StimulationIngest {
    let timer: ReturnType<typeof setInterval> | null = null;
    let onMsg: ((ev: MessageEvent) => void) | null = null;

    const poll = (): void => {
        const ws = socket.getSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const requestId = genId();

        const listener = (ev: MessageEvent): void => {
            let m: any;
            try {
                m = JSON.parse(
                    typeof ev.data === 'string' ? ev.data : String(ev.data)
                );
            } catch {
                return;
            }
            if (
                m?.type !== 'cns.stimulations.snapshot.result' ||
                m.requestId !== requestId
            )
                return;
            ws.removeEventListener('message', listener);
            if (onMsg === listener) onMsg = null;
            ingestSnapshot({
                stimulations: m.stimulations ?? [],
                attempts: m.attempts ?? [],
                tasks: m.tasks ?? [],
            });
        };
        if (onMsg) ws.removeEventListener('message', onMsg);
        onMsg = listener;
        ws.addEventListener('message', listener);

        // All scopes (the panel shows every app/cns).
        socket.send({
            type: 'cns.stimulations.snapshot',
            requestId,
            limit: SNAPSHOT_LIMIT,
        } as never);
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
