import {
    DevToolsApp,
    InitMessage,
    NeuronResponseMessage,
    ResponseBatchMessage,
    AppsActiveMessage,
    AppDisconnectedMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
    StimulationMessage,
    StimulationBatchMessage,
    Neuron,
    Collateral,
    Dendrite,
    StimulationResponse,
} from '@cnstra/devtools-dto';
import { WebSocket } from 'ws';

// Union type for all possible messages that can be broadcast
type BroadcastableMessage =
    | AppsActiveMessage
    | AppDisconnectedMessage
    | ResponseBatchMessage
    | StimulationBatchMessage
    | { type: 'app:added'; app: DevToolsApp }
    | {
          type: 'server:metrics';
          timestamp: number;
          rssMB: number;
          heapUsedMB: number;
          heapTotalMB: number;
          externalMB: number;
          cpuPercent: number;
      }
    | { type: 'apps:topology'; inits: InitMessage[] }
    | {
          type: 'apps:replays';
          appId: string;
          replays: Array<{ timestamp: number }>;
      }
    | { type: 'apps:export-stimulations'; stimulations: StimulationMessage[] }
    | {
          type: 'apps:snapshot';
          appId: string | null;
          topology: InitMessage[];
          stimulations: StimulationMessage[];
          responses: StimulationResponse[];
          createdAt: number;
          sizeBytes?: number;
          warning?: string;
      }
    | {
          type: 'cns:export-responses';
          cnsId: string;
          responses: StimulationResponse[];
      }
    | { type: 'apps:list'; apps: DevToolsApp[] }
    | {
          type: 'apps:cns';
          appId: string;
          cns: Array<{ cnsId: string; appId: string }>;
      }
    | {
          type: 'apps:responses';
          appId: string;
          responses: StimulationResponse[];
          total: number;
          offset: number;
          limit: number;
      }
    | {
          type: 'cns:responses';
          cnsId: string;
          responses: StimulationResponse[];
      };

export interface ICNSDevToolsServerRepository {
    // App management
    upsertApp(app: DevToolsApp): Promise<void> | void;
    listApps(): Promise<DevToolsApp[]> | DevToolsApp[];

    // Topology management
    upsertNeuron(neuron: Neuron): Promise<void> | void;
    upsertCollateral(collateral: Collateral): Promise<void> | void;
    upsertDendrite(dendrite: Dendrite): Promise<void> | void;
    removeNeuron?(neuronId: string): Promise<void> | void;
    removeCollateral?(collateralId: string): Promise<void> | void;
    removeDendrite?(dendriteId: string): Promise<void> | void;
    getNeuronsByCns(cnsId: string): Promise<Neuron[]> | Neuron[];
    getCollateralsByCns(cnsId: string): Promise<Collateral[]> | Collateral[];
    getDendritesByCns(cnsId: string): Promise<Dendrite[]> | Dendrite[];

    // Stimulation management
    saveStimulation(stimulation: StimulationMessage): Promise<void> | void;
    getStimulationsByApp(
        appId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
            hasError?: boolean;
            errorContains?: string;
            collateralName?: string;
            neuronId?: string;
        }
    ): Promise<StimulationMessage[]> | StimulationMessage[];

    // Response management
    saveResponse(response: StimulationResponse): Promise<void> | void;
    getResponsesByCns(
        cnsId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
            hasError?: boolean;
            errorContains?: string;
            neuronId?: string;
            collateralName?: string;
        }
    ): Promise<StimulationResponse[]> | StimulationResponse[];

    // Legacy message support
    saveMessage?(message: any): Promise<void> | void;

    // CNS management
    addCnsToApp(appId: string, cnsId: string): Promise<void> | void;
    removeCnsFromApp(appId: string, cnsId: string): Promise<void> | void;
    getCnsByApp(appId: string): Promise<string[]> | string[];
    findAppIdByCnsId(
        cnsId: string
    ): Promise<string | undefined> | string | undefined;

    // Replay management
    getReplaysByApp(
        appId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
        }
    ): Promise<Array<{ timestamp: number }>> | Array<{ timestamp: number }>;
}

export class CNSDevToolsServer {
    private stopped = false;
    private appSockets = new Map<string, WebSocket>();
    private clientSockets = new Set<WebSocket>();
    private lastInitByApp = new Map<string, InitMessage>();
    private stimulationsByApp = new Map<string, StimulationMessage[]>();
    private stimulationBuffer: StimulationMessage[] = [];
    // Topology per CNS (cnsId == devToolsInstanceId for now)
    private neuronsByCns = new Map<string, Neuron[]>();
    private dendritesByCns = new Map<string, Dendrite[]>();
    private collateralsByCns = new Map<string, Collateral[]>();
    private responsesByCns = new Map<string, StimulationResponse[]>();
    // Track app connection times
    private appFirstSeenAt = new Map<string, number>();
    private appLastSeenAt = new Map<string, number>();
    private replaysByApp = new Map<
        string,
        Array<{
            stimulationCommandId: string;
            appId: string;
            cnsId?: string;
            collateralName?: string;
            payload?: unknown;
            contexts?: unknown;
            options?: unknown;
            timestamp: number;
            result?: 'accepted' | 'rejected';
        }>
    >();

    // server metrics sampling
    private lastCpuUsage = process.cpuUsage();
    private lastCpuTime = Date.now();
    private metricsTimer?: NodeJS.Timeout;

    private static sanitizeValue(
        value: unknown,
        depth: number = 0,
        limits: {
            maxDepth: number;
            maxString: number;
            maxArray: number;
            maxObjectKeys: number;
        } = {
            maxDepth: 5,
            maxString: 2000,
            maxArray: 200,
            maxObjectKeys: 200,
        }
    ): unknown {
        if (value === null || value === undefined) return value;
        if (depth >= limits.maxDepth) return '[MaxDepth]';
        const t = typeof value;
        if (t === 'string') {
            const s = value as string;
            return s.length > limits.maxString
                ? s.slice(0, limits.maxString) +
                      `…[+${s.length - limits.maxString}]`
                : s;
        }
        if (
            t === 'number' ||
            t === 'boolean' ||
            t === 'bigint' ||
            t === 'symbol'
        )
            return value;
        if (t === 'function') return '[Function]';
        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                stack: value.stack,
            };
        }
        if (Array.isArray(value)) {
            const arr = value as unknown[];
            const slice = arr.slice(0, limits.maxArray);
            const mapped = slice.map(v =>
                this.sanitizeValue(v, depth + 1, limits)
            );
            if (arr.length > slice.length)
                mapped.push(`[…+${arr.length - slice.length} items]`);
            return mapped;
        }
        if (t === 'object') {
            const out: Record<string, unknown> = {};
            const entries = Object.entries(value as Record<string, unknown>);
            const slice = entries.slice(0, limits.maxObjectKeys);
            for (const [k, v] of slice) {
                out[k] = this.sanitizeValue(v, depth + 1, limits);
            }
            if (entries.length > slice.length) {
                out['…'] = `+${entries.length - slice.length} keys`;
            }
            return out;
        }
        return value;
    }

    constructor(private repository: ICNSDevToolsServerRepository) {}

    private isNeuronResponseMessage(
        message: unknown
    ): message is NeuronResponseMessage {
        return (
            message !== null &&
            typeof message === 'object' &&
            'stimulationId' in message &&
            'neuronId' in message &&
            'appId' in message &&
            'collateralName' in message &&
            'timestamp' in message &&
            typeof (message as any).stimulationId === 'string' &&
            typeof (message as any).neuronId === 'string' &&
            typeof (message as any).appId === 'string' &&
            typeof (message as any).collateralName === 'string' &&
            typeof (message as any).timestamp === 'number' &&
            !('type' in message)
        ); // No type field indicates raw NeuronResponseMessage
    }

    private isMessageWithType(message: unknown): message is { type: string } {
        return (
            message !== null &&
            typeof message === 'object' &&
            'type' in message &&
            typeof (message as any).type === 'string'
        );
    }

    // Expose sockets map size for tests
    /** @internal */
    get connectedAppCount(): number {
        return this.appSockets.size;
    }

    private static applyWindowAndPaginate<T extends { timestamp: number }>(
        items: ReadonlyArray<T>,
        params: {
            fromTimestamp?: number;
            toTimestamp?: number;
            offset?: number;
            limit?: number;
        }
    ): T[] {
        const { fromTimestamp, toTimestamp } = params;
        const offset = Math.max(0, params.offset ?? 0);
        const limit =
            params.limit !== undefined && params.limit > 0
                ? params.limit
                : undefined;

        // Copy, filter by time window, sort ASC by timestamp
        const filtered = items
            .filter(
                item =>
                    (fromTimestamp === undefined ||
                        item.timestamp >= fromTimestamp) &&
                    (toTimestamp === undefined || item.timestamp <= toTimestamp)
            )
            .slice() // avoid mutating original arrays
            .sort((a, b) => a.timestamp - b.timestamp);

        if (offset > 0 || limit !== undefined) {
            return filtered.slice(
                offset,
                limit !== undefined ? offset + limit : undefined
            );
        }
        return filtered;
    }

    async handleMessage(ws: WebSocket, message: unknown): Promise<unknown> {
        if (!this.isMessageWithType(message)) {
            console.warn('⚠️ Unknown message format:', message);
            return null;
        }

        switch (message.type) {
            case 'devtools-client-connect':
                console.log('🔗 DevTools client connecting...');
                this.addClient(ws);
                // Start metrics loop if not already started
                if (!this.metricsTimer) {
                    this.startMetricsLoop();
                }
                // Send response to client
                ws.send(JSON.stringify({ type: 'devtools-client-connected' }));
                console.log(
                    '✅ DevTools client connected, total clients:',
                    this.clientSockets.size
                );
                return { type: 'devtools-client-connected' };

            case 'init':
                return this.handleInit(ws, message as InitMessage);

            case 'batch':
                return this.handleBatch(
                    ws,
                    message as { type: string; items?: unknown[] }
                );

            case 'neuron-response-batch':
            case 'response-batch':
                return this.handleResponseBatch(
                    ws,
                    message as ResponseBatchMessage
                );

            case 'stimulate':
                return this.handleStimulate(ws, message as StimulateCommand);

            case 'stimulate-accepted':
                // Forward ack to clients
                try {
                    const msg = message as StimulateAccepted;
                    const cmdId = msg.stimulationCommandId;
                    const appId = msg.appId;
                    if (cmdId && appId) {
                        const arr = this.replaysByApp.get(appId) || [];
                        // Update latest matching replay by command id
                        for (let i = arr.length - 1; i >= 0; i--) {
                            if (arr[i].stimulationCommandId === cmdId) {
                                arr[i].result = 'accepted';
                                break;
                            }
                        }
                        this.replaysByApp.set(appId, arr);
                    }
                } catch {}
                return message as StimulateAccepted;

            case 'stimulate-rejected':
                // Forward nack to clients
                try {
                    const msg = message as StimulateRejected;
                    const cmdId = msg.stimulationCommandId;
                    const appId = msg.appId;
                    if (cmdId && appId) {
                        const arr = this.replaysByApp.get(appId) || [];
                        for (let i = arr.length - 1; i >= 0; i--) {
                            if (arr[i].stimulationCommandId === cmdId) {
                                arr[i].result = 'rejected';
                                break;
                            }
                        }
                        this.replaysByApp.set(appId, arr);
                    }
                } catch {}
                return message as StimulateRejected;

            case 'stimulation':
                return this.handleStimulation(
                    ws,
                    message as StimulationMessage
                );

            case 'apps:get-topology': {
                const inits = Array.from(this.lastInitByApp.values());
                return { type: 'apps:topology', inits };
            }

            case 'apps:get-stimulations': {
                const msg = message as {
                    appId?: string;
                    limit?: number;
                    fromTimestamp?: number;
                    toTimestamp?: number;
                    offset?: number;
                    hasError?: boolean;
                    errorContains?: string;
                    collateralName?: string;
                    neuronId?: string;
                };
                const {
                    appId,
                    limit,
                    fromTimestamp,
                    toTimestamp,
                    offset,
                    hasError,
                    errorContains,
                    collateralName,
                    neuronId,
                } = msg;

                let stimulations: StimulationMessage[] = [];
                if (appId) {
                    // Use normalized repository
                    stimulations = await this.repository.getStimulationsByApp(
                        appId,
                        {
                            fromTimestamp,
                            toTimestamp,
                            limit,
                            offset,
                            hasError,
                            errorContains,
                            collateralName,
                            neuronId,
                        }
                    );
                } else {
                    // Get all stimulations from all apps using repository
                    const apps = await this.repository.listApps();
                    for (const app of apps) {
                        const appStimulations =
                            await this.repository.getStimulationsByApp(
                                app.appId,
                                {
                                    fromTimestamp,
                                    toTimestamp,
                                    limit,
                                    offset,
                                    hasError,
                                    errorContains,
                                    collateralName,
                                    neuronId,
                                }
                            );
                        stimulations = stimulations.concat(appStimulations);
                    }
                    // Filters and pagination are already applied in repository calls
                    return {
                        type: 'stimulation-batch',
                        stimulations,
                    } as StimulationBatchMessage;
                }

                // Filters and pagination are already applied in repository call
                return {
                    type: 'stimulation-batch',
                    stimulations,
                } as StimulationBatchMessage;
            }

            case 'apps:get-replays': {
                const msg = message as {
                    appId?: string;
                    limit?: number;
                    fromTimestamp?: number;
                    toTimestamp?: number;
                    offset?: number;
                };
                const { appId, limit, fromTimestamp, toTimestamp, offset } =
                    msg;
                if (!appId) {
                    return { type: 'apps:replays', replays: [] };
                }
                let list = this.replaysByApp.get(appId) || [];

                // Apply filters
                if (fromTimestamp !== undefined) {
                    list = list.filter(r => r.timestamp >= fromTimestamp);
                }
                if (toTimestamp !== undefined) {
                    list = list.filter(r => r.timestamp <= toTimestamp);
                }

                // Sort by timestamp descending (most recent first)
                list = list.sort((a, b) => b.timestamp - a.timestamp);

                // Apply offset and limit
                if (offset !== undefined && offset > 0) {
                    list = list.slice(offset);
                }
                if (limit !== undefined && limit > 0) {
                    list = list.slice(0, limit);
                }

                return { type: 'apps:replays', appId, replays: list };
            }

            // Export endpoints (JSON export over WS)
            case 'apps:export-topology': {
                const { appId } = message as any;
                const inits = Array.from(this.lastInitByApp.values());
                if (appId) {
                    const filtered = inits.filter(init => {
                        const baseAppId =
                            (init as any).appId ||
                            (init as any).devToolsInstanceId;
                        return baseAppId === appId;
                    });
                    return { type: 'apps:topology', inits: filtered } as any;
                }
                return { type: 'apps:topology', inits } as any;
            }

            case 'apps:export-stimulations': {
                const {
                    appId,
                    limit,
                    fromTimestamp,
                    toTimestamp,
                    offset,
                    hasError,
                    errorContains,
                    collateralName,
                    neuronId,
                } = message as any;
                let stimulations: StimulationMessage[] = [];
                if (appId) {
                    stimulations = await this.repository.getStimulationsByApp(
                        appId,
                        {
                            fromTimestamp,
                            toTimestamp,
                            limit,
                            offset,
                            hasError,
                            errorContains,
                            collateralName,
                            neuronId,
                        }
                    );
                } else {
                    // Get all stimulations from all apps
                    const apps = await this.repository.listApps();
                    for (const app of apps) {
                        const appStimulations =
                            await this.repository.getStimulationsByApp(
                                app.appId,
                                {
                                    fromTimestamp,
                                    toTimestamp,
                                    limit,
                                    offset,
                                    hasError,
                                    errorContains,
                                    collateralName,
                                    neuronId,
                                }
                            );
                        stimulations = stimulations.concat(appStimulations);
                    }
                }
                // Filters and pagination are already applied in repository calls
                return {
                    type: 'apps:export-stimulations',
                    stimulations,
                } as any;
            }

            case 'apps:export-snapshot': {
                const { appId, limitResponses, limitStimulations } =
                    message as any;
                const inits = Array.from(this.lastInitByApp.values());
                const topology = appId
                    ? inits.filter(
                          init =>
                              ((init as any).appId ||
                                  (init as any).devToolsInstanceId) === appId
                      )
                    : inits;
                // Collect stimulations from repository
                let stimulations: StimulationMessage[] = [];
                if (appId) {
                    stimulations = await this.repository.getStimulationsByApp(
                        appId
                    );
                } else {
                    const apps = await this.repository.listApps();
                    for (const app of apps) {
                        const appStimulations =
                            await this.repository.getStimulationsByApp(
                                app.appId
                            );
                        stimulations = stimulations.concat(appStimulations);
                    }
                }

                // Collect responses from repository
                const responses: StimulationResponse[] = [];
                if (appId) {
                    // Get all CNS for this app
                    const cnsIds = await this.repository.getCnsByApp(appId);
                    for (const cnsId of cnsIds) {
                        const cnsResponses =
                            await this.repository.getResponsesByCns(cnsId);
                        responses.push(...cnsResponses);
                    }
                } else {
                    // Get all responses from all CNS
                    const apps = await this.repository.listApps();
                    for (const app of apps) {
                        const cnsIds = await this.repository.getCnsByApp(
                            app.appId
                        );
                        for (const cnsId of cnsIds) {
                            const cnsResponses =
                                await this.repository.getResponsesByCns(cnsId);
                            responses.push(...cnsResponses);
                        }
                    }
                }
                const tail = <T>(arr: T[], n?: number) =>
                    typeof n === 'number' && n > 0
                        ? arr.slice(Math.max(0, arr.length - n))
                        : arr;
                const sanitizedStim = tail(stimulations, limitStimulations).map(
                    s => ({
                        ...s,
                        payload: CNSDevToolsServer.sanitizeValue(
                            (s as any).payload
                        ),
                    })
                );
                const sanitizedResp = tail(responses, limitResponses).map(
                    r => ({
                        ...r,
                        payload: CNSDevToolsServer.sanitizeValue(
                            (r as any).payload
                        ),
                        contexts: CNSDevToolsServer.sanitizeValue(
                            (r as any).contexts
                        ),
                        responsePayload: CNSDevToolsServer.sanitizeValue(
                            (r as any).responsePayload
                        ),
                    })
                );
                const snapshot = {
                    type: 'apps:snapshot',
                    appId: appId || null,
                    topology,
                    stimulations: sanitizedStim,
                    responses: sanitizedResp,
                    createdAt: Date.now(),
                } as any;
                try {
                    const sizeBytes = Buffer.byteLength(
                        JSON.stringify(snapshot)
                    );
                    (snapshot as any).sizeBytes = sizeBytes;
                    const maxBytes = 5 * 1024 * 1024; // 5MB
                    if (sizeBytes > maxBytes) {
                        (
                            snapshot as any
                        ).warning = `Snapshot size ${sizeBytes} bytes exceeds ${maxBytes} bytes; consider narrowing filters.`;
                    }
                } catch {}
                return snapshot;
            }

            case 'cns:export-responses': {
                const {
                    cnsId,
                    limit,
                    fromTimestamp,
                    toTimestamp,
                    offset,
                    hasError,
                    errorContains,
                    neuronId,
                    collateralName,
                } = message as any;
                const responsesAll = await this.repository.getResponsesByCns(
                    cnsId,
                    {
                        fromTimestamp,
                        toTimestamp,
                        limit,
                        offset,
                        hasError,
                        errorContains,
                        neuronId,
                        collateralName,
                    }
                );
                // Filters and pagination are already applied in repository call
                return {
                    type: 'cns:export-responses',
                    cnsId,
                    responses: responsesAll,
                } as any;
            }

            // REST-like over WS
            case 'apps:list': {
                const apps = await this.repository.listApps();
                return { type: 'apps:list', apps };
            }
            case 'apps:get-cns': {
                const { appId } = message as any;
                const cnsIds = await this.repository.getCnsByApp(appId);
                const cns = cnsIds.map(cnsId => ({ cnsId, appId }));
                return { type: 'apps:cns', appId, cns };
            }

            case 'apps:get-responses': {
                const {
                    appId,
                    limit,
                    fromTimestamp,
                    toTimestamp,
                    offset,
                    hasError,
                    errorContains,
                    neuronId,
                    collateralName,
                } = message as any;

                // Get all responses from all CNS for the app
                let allResponses: StimulationResponse[] = [];
                if (appId) {
                    const cnsIds = await this.repository.getCnsByApp(appId);
                    for (const cnsId of cnsIds) {
                        const responses =
                            await this.repository.getResponsesByCns(cnsId, {
                                fromTimestamp,
                                toTimestamp,
                                hasError,
                                errorContains,
                                neuronId,
                                collateralName,
                            });
                        allResponses = allResponses.concat(responses);
                    }
                } else {
                    // Get all responses from all CNS
                    const apps = await this.repository.listApps();
                    for (const app of apps) {
                        const cnsIds = await this.repository.getCnsByApp(
                            app.appId
                        );
                        for (const cnsId of cnsIds) {
                            const responses =
                                await this.repository.getResponsesByCns(cnsId, {
                                    fromTimestamp,
                                    toTimestamp,
                                    hasError,
                                    errorContains,
                                    neuronId,
                                    collateralName,
                                });
                            allResponses = allResponses.concat(responses);
                        }
                    }
                }

                // Filters and pagination are already applied in repository calls

                // Sort by timestamp descending
                allResponses.sort((a, b) => b.timestamp - a.timestamp);

                const response = {
                    type: 'apps:responses',
                    appId: appId || 'all',
                    responses: allResponses,
                    total: allResponses.length,
                    offset: offset || 0,
                    limit: limit || allResponses.length,
                };

                // Send response to client
                ws.send(JSON.stringify(response));
                return response;
            }
            case 'cns:get-responses': {
                const msg = message as {
                    cnsId?: string;
                    limit?: number;
                    fromTimestamp?: number;
                    toTimestamp?: number;
                    offset?: number;
                    hasError?: boolean;
                    errorContains?: string;
                    neuronId?: string;
                    collateralName?: string;
                };
                const {
                    cnsId,
                    limit,
                    fromTimestamp,
                    toTimestamp,
                    offset,
                    hasError,
                    errorContains,
                    neuronId,
                    collateralName,
                } = msg;

                if (!cnsId) {
                    return { type: 'cns:responses', cnsId: '', responses: [] };
                }

                // Use normalized repository
                const responses = await this.repository.getResponsesByCns(
                    cnsId,
                    {
                        fromTimestamp,
                        toTimestamp,
                        limit,
                        offset,
                        hasError,
                        errorContains,
                        neuronId,
                        collateralName,
                    }
                );

                return { type: 'cns:responses', cnsId, responses };
            }

            default:
                console.log('Unknown message type:', message.type);
                return null;
        }
    }

    async handleInit(
        ws: WebSocket,
        message: InitMessage
    ): Promise<AppsActiveMessage> {
        // Prefer new clean fields from InitMessage
        const baseAppId = message.appId || message.devToolsInstanceId;
        const cnsId = message.cnsId || message.devToolsInstanceId;

        if (!baseAppId || !cnsId) {
            throw new Error('Invalid InitMessage: missing appId or cnsId');
        }

        this.lastInitByApp.set(cnsId, message);

        // Track connection times
        const now = Date.now();
        if (!this.appFirstSeenAt.has(baseAppId)) {
            this.appFirstSeenAt.set(baseAppId, now);
        }
        this.appLastSeenAt.set(baseAppId, now);

        const app: DevToolsApp = {
            appId: baseAppId,
            appName: message.appName,
            version: message.version!,
            firstSeenAt: this.appFirstSeenAt.get(baseAppId)!,
            lastSeenAt: now,
        };

        // Removed verbose logging
        await this.repository.upsertApp(app);

        this.appSockets.set(cnsId, ws);

        // Clean up old topology data for this CNS before storing new one
        // This ensures that if the app reconnects with different topology,
        // old neurons/collaterals/dendrites are removed
        const existingNeurons = await this.repository.getNeuronsByCns(cnsId);
        const existingCollaterals = await this.repository.getCollateralsByCns(
            cnsId
        );
        const existingDendrites = await this.repository.getDendritesByCns(
            cnsId
        );

        // Remove old topology from repository
        for (const neuron of existingNeurons) {
            if (this.repository.removeNeuron) {
                await this.repository.removeNeuron(neuron.id);
            }
        }
        for (const collateral of existingCollaterals) {
            if (this.repository.removeCollateral) {
                await this.repository.removeCollateral(collateral.id);
            }
        }
        for (const dendrite of existingDendrites) {
            if (this.repository.removeDendrite) {
                await this.repository.removeDendrite(dendrite.id);
            }
        }

        // Store new topology in normalized repository
        for (const neuron of message.neurons || []) {
            await this.repository.upsertNeuron(neuron);
        }
        for (const collateral of message.collaterals || []) {
            await this.repository.upsertCollateral(collateral);
        }
        for (const dendrite of message.dendrites || []) {
            await this.repository.upsertDendrite(dendrite);
        }

        // Also store in memory for backward compatibility
        this.neuronsByCns.set(cnsId, message.neurons || []);
        this.collateralsByCns.set(cnsId, message.collaterals || []);
        this.dendritesByCns.set(cnsId, message.dendrites || []);

        await this.repository.addCnsToApp(app.appId, cnsId);

        console.log(
            `✅ App connected: ${message.appName} (${message.devToolsInstanceId})`
        );
        console.log(
            `📊 Topology: ${message.neurons.length} neurons, ${message.collaterals.length} collaterals, ${message.dendrites.length} dendrites`
        );

        // Return apps list to broadcast
        const apps = await this.repository.listApps();

        // Send app:added event to all connected clients
        this.broadcastToClients({
            type: 'app:added',
            app: app,
        });

        // Additionally broadcast the full apps:active list so late-joined devtools panels
        // can reliably refresh their app list even if they miss app:added for any reason
        console.log(
            '📡 Broadcasting apps:active to',
            this.clientSockets.size,
            'clients:',
            {
                appsCount: apps.length,
                appIds: apps.map(a => a.appId),
            }
        );
        this.broadcastToClients({
            type: 'apps:active',
            apps: apps,
        });

        return {
            type: 'apps:active',
            apps: apps,
        };
    }

    async handleBatch(
        ws: WebSocket,
        message: { type: string; items?: unknown[] }
    ): Promise<void> {
        console.log(
            '📦 Server handling batch with',
            message.items?.length || 0,
            'items'
        );

        if (!Array.isArray(message.items)) {
            console.warn('⚠️ Invalid batch message - no items array');
            return;
        }

        // Group responses together (same logic as example-app)
        const responses: unknown[] = [];
        for (const item of message.items || []) {
            const actualMessage = (item as any).payload || item;
            if ((item as any).type === 'response') {
                responses.push(actualMessage);
            } else {
                // Handle non-response messages individually
                console.log('📦 Batch item (non-response):', {
                    type: (actualMessage as any)?.type,
                });
                await this.handleMessage(ws, actualMessage);
            }
        }

        // Send response batch if we have responses
        if (responses.length > 0) {
            console.log(
                '📦 Creating response-batch with',
                responses.length,
                'responses'
            );
            const responseBatch = {
                type: 'response-batch' as const,
                devToolsInstanceId:
                    (responses[0] as any).cnsId ||
                    (responses[0] as any).appId ||
                    'unknown',
                responses: responses as NeuronResponseMessage[],
            };
            await this.handleResponseBatch(
                ws,
                responseBatch as ResponseBatchMessage
            );
        }
    }

    async handleResponseBatch(
        ws: WebSocket,
        message: ResponseBatchMessage
    ): Promise<ResponseBatchMessage> {
        // Check for replay responses
        const replayResponses = (message.responses || []).filter(r => {
            const stimId = r.stimulationId || '';
            return typeof stimId === 'string' && stimId.includes('-replay-');
        });

        if (replayResponses.length > 0) {
            console.log('🔁 [Server] Received REPLAY response-batch:', {
                totalResponses: message.responses?.length || 0,
                replayResponsesCount: replayResponses.length,
                replayStimIds: replayResponses
                    .slice(0, 3)
                    .map(r => r.stimulationId),
                replayAppIds: replayResponses.slice(0, 3).map(r => r.appId),
            });
        }

        // Update lastSeenAt for the app
        if (message.responses && message.responses.length > 0) {
            const appId = message.responses[0].appId;
            if (appId) {
                this.appLastSeenAt.set(appId, Date.now());
            }
        }

        // Persist responses in normalized repository
        for (const response of message.responses) {
            await this.repository.saveResponse(response);
        }

        // Also persist in memory for backward compatibility
        // Extract cnsId from the first response
        if (message.responses && message.responses.length > 0) {
            const cnsId = message.responses[0].cnsId;
            if (cnsId) {
                const list = this.responsesByCns.get(cnsId) || [];
                list.push(...(message.responses || []));
                // Keep last N
                if (list.length > 2000) list.splice(0, list.length - 2000);
                this.responsesByCns.set(cnsId, list);
            }
        }

        // Broadcast to all devtools clients
        this.broadcastToClients(message);

        // Forward to clients
        return message;
    }

    async handleStimulate(
        ws: WebSocket,
        message: StimulateCommand
    ): Promise<null> {
        // Removed verbose logging

        // Determine routing target: prefer cnsId, else appId, else broadcast
        const cnsIdFromCmd = (message as any).cnsId as string | undefined;
        const appIdFromCmd = (message as any).appId as string | undefined;

        try {
            // Persist replay intent for history (best effort)
            try {
                const entry = {
                    stimulationCommandId: (message as any).stimulationCommandId,
                    appId: (message as any).appId,
                    cnsId: (message as any).cnsId,
                    collateralName: (message as any).collateralName,
                    payload: (message as any).payload,
                    contexts: (message as any).contexts,
                    options: (message as any).options,
                    timestamp: Date.now(),
                };
                const arr = this.replaysByApp.get(entry.appId) || [];
                arr.push(entry);
                if (arr.length > 1000) arr.splice(0, arr.length - 1000);
                this.replaysByApp.set(entry.appId, arr);
            } catch {}

            if (cnsIdFromCmd) {
                const appWs = this.appSockets.get(cnsIdFromCmd);
                if (appWs && appWs.readyState === 1) {
                    appWs.send(JSON.stringify(message));
                    console.log(
                        `📨 Stimulate forwarded to cns ${cnsIdFromCmd}`
                    );
                } else {
                    console.warn(
                        `⚠️ CNS socket not available for ${cnsIdFromCmd}`
                    );
                }
            } else if (appIdFromCmd) {
                const cnsIds = await this.repository.getCnsByApp(appIdFromCmd);
                let count = 0;
                for (const cnsId of cnsIds) {
                    const appWs = this.appSockets.get(cnsId);
                    if (appWs && appWs.readyState === 1) {
                        appWs.send(JSON.stringify(message));
                        count++;
                    }
                }
                console.log(
                    `📨 Stimulate forwarded to ${count} CNS of app ${appIdFromCmd}`
                );
            } else {
                // Fallback: broadcast to all app sockets
                let count = 0;
                for (const [, appWs] of Array.from(this.appSockets.entries())) {
                    if (appWs.readyState === 1) {
                        appWs.send(JSON.stringify(message));
                        count++;
                    }
                }
                // Removed verbose logging
            }
        } catch (e) {
            console.error('❌ Failed to forward stimulate:', e);
        }

        return null;
    }

    async handleDisconnect(ws: WebSocket): Promise<void> {
        // Remove from app sockets
        for (const [cnsId, socket] of Array.from(this.appSockets.entries())) {
            if (socket === ws) {
                this.appSockets.delete(cnsId);
                console.log(`❌ CNS disconnected: ${cnsId}`);

                // Derive base appId from cnsId
                const sepIdx = cnsId.indexOf(':');
                const baseAppId = sepIdx > 0 ? cnsId.slice(0, sepIdx) : cnsId;

                // Remove per-CNS cached topology
                this.neuronsByCns.delete(cnsId);
                this.dendritesByCns.delete(cnsId);
                this.collateralsByCns.delete(cnsId);
                this.responsesByCns.delete(cnsId);
                this.lastInitByApp.delete(cnsId);

                // Update cnsByApp mapping
                await this.repository.removeCnsFromApp(baseAppId, cnsId);
                break;
            }
        }

        // Remove from client sockets
        this.clientSockets.delete(ws);
    }

    addClient(ws: WebSocket): void {
        this.clientSockets.add(ws);
        // start metrics loop on first client
        if (!this.metricsTimer) {
            this.startMetricsLoop();
        }

        // Handle client disconnection
        ws.on('close', () => {
            this.removeClient(ws);
        });
        ws.on('error', () => {
            this.removeClient(ws);
        });
    }

    removeClient(ws: WebSocket): void {
        this.clientSockets.delete(ws);
    }

    async handleStimulation(
        ws: WebSocket,
        message: StimulationMessage
    ): Promise<void> {
        // Removed verbose logging - too frequent

        // Store stimulation in normalized repository
        await this.repository.saveStimulation(message);

        // Also store in memory for backward compatibility
        const appStimulations = this.stimulationsByApp.get(message.appId) || [];
        appStimulations.push(message);

        // Keep only last 1000 stimulations per app to prevent memory issues
        if (appStimulations.length > 1000) {
            appStimulations.splice(0, appStimulations.length - 1000);
        }

        this.stimulationsByApp.set(message.appId, appStimulations);

        // Add to buffer for batch sending
        this.stimulationBuffer.push(message);

        // Send immediately to all connected devtools clients
        this.broadcastToClients({
            type: 'stimulation-batch',
            stimulations: [message],
        } as StimulationBatchMessage);
    }

    private broadcastToClients(message: BroadcastableMessage): void {
        const messageStr = JSON.stringify(message);
        let sentCount = 0;
        this.clientSockets.forEach(clientWs => {
            if (clientWs.readyState === 1) {
                // WebSocket.OPEN
                try {
                    clientWs.send(messageStr);
                    sentCount++;
                } catch (error) {
                    console.error(
                        '❌ Failed to send message to client:',
                        error
                    );
                }
            }
        });
        // Only log if not all clients received the message
        if (sentCount !== this.clientSockets.size) {
            console.warn(
                `⚠️ Sent message to ${sentCount}/${this.clientSockets.size} clients`
            );
        }
    }

    private startMetricsLoop(): void {
        // Don't start if already running
        if (this.metricsTimer) {
            return;
        }

        this.lastCpuUsage = process.cpuUsage();
        this.lastCpuTime = Date.now();
        this.metricsTimer = setInterval(() => {
            if (this.stopped) {
                clearInterval(this.metricsTimer);
                this.metricsTimer = undefined;
                return;
            }
            try {
                const mem = process.memoryUsage();
                const now = Date.now();
                const cpu = process.cpuUsage(this.lastCpuUsage);
                const elapsedMs = Math.max(1, now - this.lastCpuTime);
                const userMs = cpu.user / 1000;
                const systemMs = cpu.system / 1000;
                const cpuPercent = Math.min(
                    100,
                    Math.round(((userMs + systemMs) / elapsedMs) * 100)
                );
                this.lastCpuUsage = process.cpuUsage();
                this.lastCpuTime = now;

                const payload = {
                    type: 'server:metrics',
                    timestamp: now,
                    rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
                    heapUsedMB:
                        Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
                    heapTotalMB:
                        Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
                    externalMB:
                        Math.round((mem.external / 1024 / 1024) * 100) / 100,
                    cpuPercent,
                } as any;
                this.broadcastToClients(payload);
            } catch {}
        }, 1000);
    }

    async getActiveApps(): Promise<DevToolsApp[]> {
        return await this.repository.listApps();
    }

    stop(): void {
        console.log('Stopping server!');
        this.stopped = true;
        // Clear metrics timer
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = undefined;
        }

        // Close all app sockets
        for (const ws of Array.from(this.appSockets.values())) {
            ws.close();
        }
        this.appSockets.clear();

        // Close all client sockets
        for (const ws of Array.from(this.clientSockets)) {
            ws.close();
        }
        this.clientSockets.clear();

        // Clear all data
        this.lastInitByApp.clear();
        this.stimulationsByApp.clear();
        this.stimulationBuffer = [];
        this.neuronsByCns.clear();
        this.dendritesByCns.clear();
        this.collateralsByCns.clear();
        this.responsesByCns.clear();
        this.appFirstSeenAt.clear();
        this.appLastSeenAt.clear();
        this.replaysByApp.clear();
    }
}
