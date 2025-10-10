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
} from '@cnstra/devtools-dto';
import { WebSocket } from 'ws';

export interface ICNSDevToolsServerRepository {
    upsertApp(app: DevToolsApp): Promise<void> | void;
    listApps(): Promise<DevToolsApp[]> | DevToolsApp[];
    saveMessage(message: any): Promise<void> | void;
}

export class CNSDevToolsServer {
    private appSockets = new Map<string, WebSocket>();
    private clientSockets = new Set<WebSocket>();
    private lastInitByApp = new Map<string, InitMessage>();
    private stimulationsByApp = new Map<string, StimulationMessage[]>();
    private stimulationBuffer: StimulationMessage[] = [];
    // Topology per CNS (cnsId == devToolsInstanceId for now)
    private neuronsByCns = new Map<string, any[]>();
    private dendritesByCns = new Map<string, any[]>();
    private collateralsByCns = new Map<string, any[]>();
    private responsesByCns = new Map<string, any[]>();
    private cnsByApp = new Map<string, Set<string>>();
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
            return value as any;
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

    private isNeuronResponseMessage(message: any): boolean {
        return (
            message &&
            typeof message.stimulationId === 'string' &&
            typeof message.neuronId === 'string' &&
            typeof message.appId === 'string' &&
            typeof message.collateralName === 'string' &&
            typeof message.timestamp === 'number' &&
            !message.type
        ); // No type field indicates raw NeuronResponseMessage
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

    async handleMessage(ws: WebSocket, message: any): Promise<any> {
        console.log(
            '🔧 Server received message:',
            JSON.stringify(message, null, 2)
        );
        switch (message.type) {
            case 'init':
                return this.handleInit(ws, message as InitMessage);

            case 'neuron-response-batch':
            case 'response-batch':
                return this.handleResponseBatch(
                    ws,
                    message as ResponseBatchMessage
                );

            case 'stimulate':
                return this.handleStimulate(ws, message as StimulateCommand);

            case 'stimulate-accepted':
                await this.repository.saveMessage(message);
                // Forward ack to clients
                try {
                    const cmdId = (message as any).stimulationCommandId as
                        | string
                        | undefined;
                    const appId = (message as any).appId as string | undefined;
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
                await this.repository.saveMessage(message);
                // Forward nack to clients
                try {
                    const cmdId = (message as any).stimulationCommandId as
                        | string
                        | undefined;
                    const appId = (message as any).appId as string | undefined;
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
                return { type: 'apps:topology', inits } as any;
            }

            case 'apps:get-stimulations': {
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
                    stimulations = this.stimulationsByApp.get(appId) || [];
                } else {
                    // Merge all apps' stimulations when appId is not provided
                    const vals = Array.from(this.stimulationsByApp.values());
                    for (const arr of vals) {
                        stimulations = stimulations.concat(arr);
                    }
                }
                // Optional error filter
                if (typeof hasError === 'boolean') {
                    stimulations = stimulations.filter(s => {
                        const e = (s as any).error;
                        const isErr = e !== null && e !== undefined && e !== '';
                        return hasError ? isErr : !isErr;
                    });
                }
                if (
                    typeof errorContains === 'string' &&
                    errorContains.length > 0
                ) {
                    const needle = errorContains.toLowerCase();
                    stimulations = stimulations.filter(s =>
                        String((s as any).error || '')
                            .toLowerCase()
                            .includes(needle)
                    );
                }
                if (
                    typeof collateralName === 'string' &&
                    collateralName.length > 0
                ) {
                    stimulations = stimulations.filter(
                        s => s.collateralName === collateralName
                    );
                }
                if (typeof neuronId === 'string' && neuronId.length > 0) {
                    stimulations = stimulations.filter(
                        s => (s as any).neuronId === neuronId
                    );
                }
                const out = CNSDevToolsServer.applyWindowAndPaginate(
                    stimulations,
                    {
                        fromTimestamp,
                        toTimestamp,
                        offset,
                        limit,
                    }
                );
                return {
                    type: 'stimulation-batch',
                    stimulations: out,
                } as StimulationBatchMessage;
            }

            case 'apps:get-replays': {
                const { appId, limit, fromTimestamp, toTimestamp, offset } =
                    message as any;
                let list: Array<{ timestamp: number }> = [] as any;
                if (appId) list = (this.replaysByApp.get(appId) || []) as any;
                const out = CNSDevToolsServer.applyWindowAndPaginate(list, {
                    fromTimestamp,
                    toTimestamp,
                    offset,
                    limit,
                });
                return { type: 'apps:replays', appId, replays: out } as any;
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
                    stimulations = this.stimulationsByApp.get(appId) || [];
                } else {
                    for (const arr of this.stimulationsByApp.values()) {
                        stimulations = stimulations.concat(arr);
                    }
                }
                if (typeof hasError === 'boolean') {
                    stimulations = stimulations.filter(s => {
                        const e = (s as any).error;
                        const isErr = e !== null && e !== undefined && e !== '';
                        return hasError ? isErr : !isErr;
                    });
                }
                if (
                    typeof errorContains === 'string' &&
                    errorContains.length > 0
                ) {
                    const needle = errorContains.toLowerCase();
                    stimulations = stimulations.filter(s =>
                        String((s as any).error || '')
                            .toLowerCase()
                            .includes(needle)
                    );
                }
                if (
                    typeof collateralName === 'string' &&
                    collateralName.length > 0
                ) {
                    stimulations = stimulations.filter(
                        s => s.collateralName === collateralName
                    );
                }
                if (typeof neuronId === 'string' && neuronId.length > 0) {
                    stimulations = stimulations.filter(
                        s => (s as any).neuronId === neuronId
                    );
                }
                const out = CNSDevToolsServer.applyWindowAndPaginate(
                    stimulations,
                    {
                        fromTimestamp,
                        toTimestamp,
                        offset,
                        limit,
                    }
                );
                return {
                    type: 'apps:export-stimulations',
                    stimulations: out,
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
                // Collect stimulations
                const stimulations = appId
                    ? this.stimulationsByApp.get(appId) || []
                    : Array.from(this.stimulationsByApp.values()).flat();
                // Collect responses per app
                const responses: any[] = [];
                for (const [cnsId, list] of Array.from(
                    this.responsesByCns.entries()
                )) {
                    const base = this.findAppIdByCnsId(cnsId);
                    if (!appId || base === appId) responses.push(...list);
                }
                const tail = (arr: any[], n?: number) =>
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
                const responsesAll = this.responsesByCns.get(cnsId) || [];
                let responses = responsesAll as any[];
                if (typeof hasError === 'boolean') {
                    responses = responses.filter(r => {
                        const e = (r as any).error;
                        const isErr = e !== null && e !== undefined && e !== '';
                        return hasError ? isErr : !isErr;
                    });
                }
                if (
                    typeof errorContains === 'string' &&
                    errorContains.length > 0
                ) {
                    const needle = errorContains.toLowerCase();
                    responses = responses.filter(r =>
                        String((r as any).error || '')
                            .toLowerCase()
                            .includes(needle)
                    );
                }
                if (typeof neuronId === 'string' && neuronId.length > 0) {
                    responses = responses.filter(
                        r => (r as any).neuronId === neuronId
                    );
                }
                if (
                    typeof collateralName === 'string' &&
                    collateralName.length > 0
                ) {
                    responses = responses.filter(
                        r => (r as any).collateralName === collateralName
                    );
                }
                responses = CNSDevToolsServer.applyWindowAndPaginate(
                    responses as any,
                    {
                        fromTimestamp,
                        toTimestamp,
                        offset,
                        limit,
                    }
                );
                return {
                    type: 'cns:export-responses',
                    cnsId,
                    responses,
                } as any;
            }

            // REST-like over WS
            case 'apps:list': {
                const apps = await this.repository.listApps();
                return { type: 'apps:list', apps };
            }
            case 'apps:get-cns': {
                const { appId } = message as any;
                const set = this.cnsByApp.get(appId) || new Set<string>();
                const cns = Array.from(set).map(cnsId => ({ cnsId, appId }));
                return { type: 'apps:cns', appId, cns };
            }
            case 'cns:get-neurons': {
                const { cnsId } = message as any;
                return {
                    type: 'cns:neurons',
                    cnsId,
                    neurons: this.neuronsByCns.get(cnsId) || [],
                };
            }
            case 'cns:get-dendrites': {
                const { cnsId } = message as any;
                return {
                    type: 'cns:dendrites',
                    cnsId,
                    dendrites: this.dendritesByCns.get(cnsId) || [],
                };
            }
            case 'cns:get-collaterals': {
                const { cnsId } = message as any;
                return {
                    type: 'cns:collaterals',
                    cnsId,
                    collaterals: this.collateralsByCns.get(cnsId) || [],
                };
            }
            case 'cns:get-responses': {
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
                const responsesAll = this.responsesByCns.get(cnsId) || [];
                let responses = responsesAll as any[];
                if (typeof hasError === 'boolean') {
                    responses = responses.filter(r => {
                        const e = (r as any).error;
                        const isErr = e !== null && e !== undefined && e !== '';
                        return hasError ? isErr : !isErr;
                    });
                }
                if (
                    typeof errorContains === 'string' &&
                    errorContains.length > 0
                ) {
                    const needle = errorContains.toLowerCase();
                    responses = responses.filter(r =>
                        String((r as any).error || '')
                            .toLowerCase()
                            .includes(needle)
                    );
                }
                if (typeof neuronId === 'string' && neuronId.length > 0) {
                    responses = responses.filter(
                        r => (r as any).neuronId === neuronId
                    );
                }
                if (
                    typeof collateralName === 'string' &&
                    collateralName.length > 0
                ) {
                    responses = responses.filter(
                        r => (r as any).collateralName === collateralName
                    );
                }
                responses = CNSDevToolsServer.applyWindowAndPaginate(
                    responses as any,
                    {
                        fromTimestamp,
                        toTimestamp,
                        offset,
                        limit,
                    }
                );
                return { type: 'cns:responses', cnsId, responses };
            }

            default:
                // Handle NeuronResponseMessage without type field (from devtools transport)
                if (this.isNeuronResponseMessage(message)) {
                    const stimulationMessage: StimulationMessage = {
                        type: 'stimulation',
                        appId: message.appId,
                        stimulationId: message.stimulationId,
                        timestamp: message.timestamp,
                        neuronId: message.neuronId,
                        collateralName: message.collateralName,
                        payload: message.payload,
                        queueLength: 0, // TODO: Get actual queue length
                        error: message.error,
                    };
                    return this.handleStimulation(ws, stimulationMessage);
                }
                console.log('Unknown message type:', message.type);
                return null;
        }
    }

    async handleInit(
        ws: WebSocket,
        message: InitMessage
    ): Promise<AppsActiveMessage> {
        // Prefer new clean fields from InitMessage
        const baseAppId =
            (message as any).appId || (message as any).devToolsInstanceId;
        const cnsId =
            (message as any).cnsId || (message as any).devToolsInstanceId;

        this.lastInitByApp.set(cnsId, message as any);
        const app: DevToolsApp = {
            appId: baseAppId as any,
            appName: message.appName,
            version: message.version,
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
        };

        console.log('🔧 Creating app object:', JSON.stringify(app, null, 2));
        await this.repository.upsertApp(app);
        await this.repository.saveMessage(message);

        this.appSockets.set(cnsId as any, ws);

        // Store topology per CNS (use derived cnsId from legacy id)
        this.neuronsByCns.set(cnsId as any, (message as any).neurons || []);
        this.collateralsByCns.set(
            cnsId as any,
            (message as any).collaterals || []
        );
        this.dendritesByCns.set(cnsId as any, (message as any).dendrites || []);
        const set = this.cnsByApp.get(app.appId) || new Set<string>();
        set.add(cnsId as any);
        this.cnsByApp.set(app.appId, set);

        console.log(
            `✅ App connected: ${message.appName} (${message.devToolsInstanceId})`
        );
        console.log(
            `📊 Topology: ${message.neurons.length} neurons, ${message.collaterals.length} collaterals, ${message.dendrites.length} dendrites`
        );

        // Return apps list to broadcast
        const apps = await this.repository.listApps();
        console.log('📋 Server returning apps:', JSON.stringify(apps, null, 2));
        return {
            type: 'apps:active',
            apps: apps,
        };
    }

    async handleResponseBatch(
        ws: WebSocket,
        message: ResponseBatchMessage
    ): Promise<ResponseBatchMessage> {
        await this.repository.saveMessage(message);
        console.log(`📦 Response batch: ${message.responses.length} responses`);

        // Persist responses per cnsId (instanceId)
        const cnsId =
            (message as any).instanceId || (message as any).devToolsInstanceId;
        if (cnsId) {
            const list = this.responsesByCns.get(cnsId) || [];
            list.push(...(message.responses || []));
            // Keep last N
            if (list.length > 2000) list.splice(0, list.length - 2000);
            this.responsesByCns.set(cnsId, list);
        }

        // Forward to clients
        return message;
    }

    async handleStimulate(
        ws: WebSocket,
        message: StimulateCommand
    ): Promise<null> {
        await this.repository.saveMessage(message);
        console.log(`🎯 Stimulate command received`);

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
                const cnsSet = this.cnsByApp.get(appIdFromCmd);
                let count = 0;
                if (cnsSet) {
                    for (const cnsId of Array.from(cnsSet.values())) {
                        const appWs = this.appSockets.get(cnsId);
                        if (appWs && appWs.readyState === 1) {
                            appWs.send(JSON.stringify(message));
                            count++;
                        }
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
                console.log(`📨 Stimulate broadcast to ${count} app(s)`);
            }
        } catch (e) {
            console.error('❌ Failed to forward stimulate:', e);
        }

        return null;
    }

    private findAppIdByCnsId(cnsId?: string): string | undefined {
        if (!cnsId) return undefined;
        for (const [appId, set] of Array.from(this.cnsByApp.entries())) {
            if (set.has(cnsId)) return appId;
        }
        return undefined;
    }

    handleDisconnect(ws: WebSocket): void {
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
                const cnsSet = this.cnsByApp.get(baseAppId);
                if (cnsSet) {
                    cnsSet.delete(cnsId);
                    if (cnsSet.size === 0) {
                        this.cnsByApp.delete(baseAppId);
                        this.stimulationsByApp.delete(baseAppId);
                    } else {
                        this.cnsByApp.set(baseAppId, cnsSet);
                    }
                }
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
    }

    async handleStimulation(
        ws: WebSocket,
        message: StimulationMessage
    ): Promise<void> {
        console.log('🧠 Server received stimulation:', {
            appId: message.appId,
            neuronId: message.neuronId,
            collateralName: message.collateralName,
            timestamp: message.timestamp,
        });

        // Store stimulation for the app
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

        // Save to repository
        await this.repository.saveMessage(message);
    }

    private broadcastToClients(message: any): void {
        const messageStr = JSON.stringify(message);
        this.clientSockets.forEach(clientWs => {
            if (clientWs.readyState === 1) {
                // WebSocket.OPEN
                clientWs.send(messageStr);
            }
        });
    }

    private startMetricsLoop(): void {
        this.lastCpuUsage = process.cpuUsage();
        this.lastCpuTime = Date.now();
        this.metricsTimer = setInterval(() => {
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
}
