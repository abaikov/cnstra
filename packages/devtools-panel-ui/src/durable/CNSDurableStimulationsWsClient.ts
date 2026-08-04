import type { ICNSDurableStimulationsClient } from './ICNSDurableStimulationsClient';
import type { TCNSStimulationViewDTO } from '@cnstra/devtools-dto';
import type { DevtoolsSocket } from '../app/controllers/socket';
import { socketRequest } from './socketRequest';

/**
 * WS-backed durable-runs client (Phase 2b-3): reads the name-based
 * Stimulation→Attempt→Task roster from the devtools-server over the SAME socket
 * the panel already uses, and drives retry/clone through the Phase 2b-2 messages.
 * Same {@link ICNSDurableStimulationsClient} seam as the HTTP admin client, so the exact
 * same page renders the live observability stream.
 *
 * There is no `launch` here — the panel observes an app; the app initiates
 * stimulations, not the panel. `launch` rejects and the page hides its button.
 */
const genId = (): string =>
    `dr-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class CNSDurableStimulationsWsClient implements ICNSDurableStimulationsClient {
    constructor(
        private readonly socket: DevtoolsSocket,
        private readonly getScopeName: () => string | undefined
    ) {}

    async listStimulations(): Promise<TCNSStimulationViewDTO[]> {
        return socketRequest<TCNSStimulationViewDTO[]>(
            this.socket,
            {
                type: 'cns.stimulations.query',
                requestId: genId(),
                scopeName: this.getScopeName(),
            },
            (m, resolve) => {
                if (m.type === 'cns.stimulations.result')
                    resolve(m.stimulations as TCNSStimulationViewDTO[]);
            }
        );
    }

    async info(): Promise<{ backend: string }> {
        return { backend: 'devtools (live)' };
    }

    async launch(): Promise<string> {
        throw new Error('launch is not available in observability mode');
    }

    async retry(stimulationId: string): Promise<void> {
        await socketRequest<void>(
            this.socket,
            {
                type: 'stimulation.retry',
                requestId: genId(),
                stimulationId: stimulationId,
            },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.retry.accepted') resolve(undefined);
                else if (m.type === 'stimulation.retry.rejected')
                    reject(new Error(m.reason ?? 'retry rejected'));
            }
        );
    }

    async clone(stimulationId: string): Promise<string> {
        return socketRequest<string>(
            this.socket,
            {
                type: 'stimulation.clone',
                requestId: genId(),
                stimulationId: stimulationId,
            },
            (m, resolve, reject) => {
                if (m.type === 'stimulation.clone.accepted')
                    resolve(m.newStimulationId as string);
                else if (m.type === 'stimulation.clone.rejected')
                    reject(new Error(m.reason ?? 'clone rejected'));
            }
        );
    }
}
