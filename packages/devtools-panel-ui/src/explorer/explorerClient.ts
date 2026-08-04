import { socketRequest } from './socketRequest';
import type { DevtoolsSocket } from '../app/controllers/socket';
import type {
    TCNSStimulationRowDTO,
    TCNSStimulationFacetsDTO,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/devtools-dto';
import { toServerFilter, type TCNSExplorerQuery } from './queryState';

// Talks the explorer BUCKET protocol (list / facets / detail) to the devtools-server
// over the shared socket. Each call is one request/reply; responses are flat buckets
// the caller upserts into OIMDB — no tree assembly here.

const genId = (): string =>
    `ex-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface TCNSExplorerListResult {
    stimulations: TCNSStimulationRowDTO[];
    nextCursor: string | null;
    total?: number;
}
export interface TCNSExplorerDetail {
    attempts: TCNSStimulationAttempt[];
    tasks: TCNSStimulationTask[];
}

export class CNSExplorerWsClient {
    constructor(private readonly socket: DevtoolsSocket) {}

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
