import { socketRequest } from './socketRequest';
import type { DevtoolsSocket } from '../app/controllers/socket';
import type {
    TCNSStimulationRowDTO,
    TCNSStimulationFacetsDTO,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSNeuronDTO,
    TCNSCollateralDTO,
    TCNSDendriteDTO,
} from '@cnstra/devtools-dto';
import type { TCNSScheduledStimulationFilter, TCNSScheduledStimulationPage, TCNSSignalJSON, TCNSStimulationCommand } from '@cnstra/persist-dto';
import { toServerFilter, type TCNSExplorerQuery } from './queryState';

// Talks the explorer BUCKET protocol (list / facets / detail / snapshot) plus the
// lightweight topology feed (topology.query) to the devtools-server over the shared
// devtools connection. Each call is one request/reply; responses are flat buckets
// the caller keeps in bindables — no tree assembly here.
//
// Nothing here knows which wire it is on: `socketRequest` sends a message and
// correlates the reply by `requestId`, and both the WebSocket and the HTTP
// polling transport carry the identical frames.

const genId = (): string =>
    `ex-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type TCNSExplorerListResult = {
    stimulations: TCNSStimulationRowDTO[];
    nextCursor: string | null;
    total?: number;
};
export type TCNSExplorerDetail = {
    attempts: TCNSStimulationAttempt[];
    tasks: TCNSStimulationTask[];
};
/** The bounded newest-first run set as flat buckets — feeds the Tasks list + aggregates. */
export type TCNSExplorerSnapshot = {
    stimulations: TCNSStimulationRowDTO[];
    attempts: TCNSStimulationAttempt[];
    tasks: TCNSStimulationTask[];
};
/** Lightweight topology (neurons/collaterals/dendrites), flattened over all cns scopes. */
export type TCNSExplorerTopology = {
    neurons: TCNSNeuronDTO[];
    collaterals: TCNSCollateralDTO[];
    dendrites: TCNSDendriteDTO[];
};

export type TCNSExplorerScheduled = TCNSScheduledStimulationPage & {
    available: boolean;
};

export class CNSExplorerWsClient {
    constructor(private readonly socket: DevtoolsSocket) {}

    scheduled(
        filter: TCNSScheduledStimulationFilter,
        cursor?: string,
        limit = 50
    ): Promise<TCNSExplorerScheduled> {
        return socketRequest<TCNSExplorerScheduled>(
            this.socket,
            {
                type: 'cns.scheduled.list',
                requestId: genId(),
                filter,
                ...(cursor ? { cursor } : {}),
                limit,
            },
            (m, resolve) => {
                if (m.type === 'cns.scheduled.list.result')
                    resolve({
                        available: m.available,
                        rows: m.rows,
                        schedules: m.schedules,
                        types: m.types ?? [],
                        nextCursor: m.nextCursor ?? null,
                    });
            }
        );
    }

    list(
        q: TCNSExplorerQuery,
        cursor?: string,
        limit = 50
    ): Promise<TCNSExplorerListResult> {
        return socketRequest<TCNSExplorerListResult>(
            this.socket,
            {
                type: 'cns.stimulations.list',
                requestId: genId(),
                scopeName: q.scopeName,
                filter: toServerFilter(q),
                ...(cursor ? { cursor } : {}),
                limit,
            },
            (m, resolve) => {
                if (m.type === 'cns.stimulations.list.result')
                    resolve({
                        stimulations: m.stimulations,
                        nextCursor: m.nextCursor ?? null,
                        total: m.total,
                    });
            }
        );
    }

    facets(q: TCNSExplorerQuery): Promise<TCNSStimulationFacetsDTO> {
        return socketRequest<TCNSStimulationFacetsDTO>(
            this.socket,
            {
                type: 'cns.stimulations.facets',
                requestId: genId(),
                scopeName: q.scopeName,
                filter: toServerFilter(q),
                ...(q.metricPath ? { metricPath: q.metricPath } : {}),
            },
            (m, resolve) => {
                if (m.type === 'cns.stimulations.facets.result')
                    resolve(m.facets);
            }
        );
    }

    launch(entry: TCNSSignalJSON): Promise<string> {
        return socketRequest<string>(
            this.socket,
            { type: 'stimulation.launch', requestId: genId(), entry },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.launch.accepted') resolve(m.newStimulationId as string);
                else if (m.type === 'stimulation.launch.rejected') reject(new Error(m.reason ?? 'launch rejected'));
            }
        );
    }

    command(stimulationId: string, command: TCNSStimulationCommand): Promise<void> {
        return socketRequest<void>(
            this.socket,
            { type: 'stimulation.command', requestId: genId(), stimulationId, command },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.command.accepted') resolve(undefined);
                else if (m.type === 'stimulation.command.rejected') reject(new Error(m.reason ?? 'command rejected'));
            }
        );
    }

    /** Resume the run's outstanding frontier (Phase 2b-2 server→app command). */
    retry(stimulationId: string): Promise<void> {
        return socketRequest<void>(
            this.socket,
            { type: 'stimulation.retry', requestId: genId(), stimulationId },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.retry.accepted') resolve(undefined);
                else if (m.type === 'stimulation.retry.rejected')
                    reject(new Error(m.reason ?? 'retry rejected'));
            }
        );
    }

    /** Start a fresh run from this run's entry signal. Returns the new run id. */
    clone(stimulationId: string): Promise<string> {
        return socketRequest<string>(
            this.socket,
            { type: 'stimulation.clone', requestId: genId(), stimulationId },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.clone.accepted')
                    resolve(m.newStimulationId as string);
                else if (m.type === 'stimulation.clone.rejected')
                    reject(new Error(m.reason ?? 'clone rejected'));
            }
        );
    }

    /** Lightweight topology feed (neurons/collaterals/dendrites), flattened. */
    topology(scopeName?: string): Promise<TCNSExplorerTopology> {
        return socketRequest<TCNSExplorerTopology>(
            this.socket,
            {
                type: 'topology.query',
                requestId: genId(),
                ...(scopeName ? { cnsId: scopeName } : {}),
            },
            (m, resolve) => {
                if (m.type === 'topology.result') {
                    const neurons: TCNSNeuronDTO[] = [];
                    const collaterals: TCNSCollateralDTO[] = [];
                    const dendrites: TCNSDendriteDTO[] = [];
                    for (const s of m.snapshots ?? []) {
                        neurons.push(...(s.neurons ?? []));
                        collaterals.push(...(s.collaterals ?? []));
                        dendrites.push(...(s.dendrites ?? []));
                    }
                    resolve({ neurons, collaterals, dendrites });
                }
            }
        );
    }

    /**
     * The bounded newest-first run set as flat buckets (Tasks list + aggregates).
     *
     * `skipDetailFor` names the runs whose attempts and tasks the caller already
     * holds; the result omits them and the caller keeps what it has. The rows
     * always come in full, so a run that moved is still visible immediately.
     */
    snapshot(
        q: TCNSExplorerQuery,
        limit = 200,
        skipDetailFor?: readonly string[]
    ): Promise<TCNSExplorerSnapshot> {
        return socketRequest<TCNSExplorerSnapshot>(
            this.socket,
            {
                type: 'cns.stimulations.snapshot',
                requestId: genId(),
                scopeName: q.scopeName,
                filter: toServerFilter(q),
                limit,
                ...(skipDetailFor?.length
                    ? { skipDetailFor: [...skipDetailFor] }
                    : {}),
            },
            (m, resolve) => {
                if (m.type === 'cns.stimulations.snapshot.result')
                    resolve({
                        stimulations: m.stimulations,
                        attempts: m.attempts,
                        tasks: m.tasks,
                    });
            }
        );
    }

    detail(stimulationId: string): Promise<TCNSExplorerDetail> {
        return socketRequest<TCNSExplorerDetail>(
            this.socket,
            {
                type: 'cns.stimulation.detail',
                requestId: genId(),
                stimulationId,
            },
            (m, resolve) => {
                if (m.type === 'cns.stimulation.detail.result')
                    resolve({ attempts: m.attempts, tasks: m.tasks });
            }
        );
    }
}
