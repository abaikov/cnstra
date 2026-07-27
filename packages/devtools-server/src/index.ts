import {
    CNSDTOApp,
    CNSDTOAppBatchMessageSchema,
    CNSDTOClientMessageSchema,
    CNSDTOTopologyMessage,
} from '@cnstra/devtools-dto';
import type { ICNSStimulationRepository } from '@cnstra/persist';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import { WebSocket } from 'ws';

// ─── Repository interface ─────────────────────────────────────────────────────

export type CNSDTOTopologySnapshot = Omit<CNSDTOTopologyMessage, 'type'>;

export interface ICNSDevToolsServerRepository {
    // Apps
    upsertApp(app: CNSDTOApp): void | Promise<void>;
    listApps(): CNSDTOApp[] | Promise<CNSDTOApp[]>;

    // Topology
    saveTopology(snapshot: CNSDTOTopologySnapshot): void | Promise<void>;
    getTopology(cnsId?: string): CNSDTOTopologySnapshot[] | Promise<CNSDTOTopologySnapshot[]>;

    // CNS ↔ App mapping
    addCnsToApp(appId: string, cnsId: string): void | Promise<void>;
    getCnsByApp(appId: string): string[] | Promise<string[]>;
    findAppByCns(cnsId: string): string | undefined | Promise<string | undefined>;
}

// ─── Server ───────────────────────────────────────────────────────────────────

export class CNSDevToolsServer {
    /** WebSocket → appId (for app clients) */
    private appSockets = new Map<WebSocket, string>();
    /** appId → WebSocket[] (one app may have multiple CNS instances) */
    private appWsByAppId = new Map<string, Set<WebSocket>>();
    /** WebSocket clients that registered as UI clients */
    private uiClients = new Set<WebSocket>();

    private metricsTimer?: NodeJS.Timeout;
    private lastCpuUsage = process.cpuUsage();
    private lastCpuTime = Date.now();

    /**
     * Name-based durable store (Stimulation/Attempt/Task). Written from the three
     * `cns.stimulation*` batch items the producer emits when `trackStimulations` is on.
     * Defaults to in-memory; the example-app can inject a Postgres store.
     */
    private readonly stimulationRepository: ICNSStimulationRepository;

    constructor(
        private readonly repository: ICNSDevToolsServerRepository,
        stimulationRepository: ICNSStimulationRepository = new CNSInMemoryStimulationRepository()
    ) {
        this.stimulationRepository = stimulationRepository;
    }

    // ─── Message entry point ─────────────────────────────────────────────────

    async handleMessage(
        ws: WebSocket,
        raw: unknown
    ): Promise<void> {
        if (typeof raw !== 'string' && typeof raw !== 'object') return;

        let data: unknown;
        try {
            data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return;
        }

        if (!data || typeof data !== 'object' || !('type' in data)) return;
        const type = (data as any).type as string;

        // App batch (topology + stimulation events)
        if (type === 'batch') {
            const result = CNSDTOAppBatchMessageSchema.safeParse(data);
            if (!result.success) return;
            for (const item of result.data.items) {
                await this.handleAppBatchItem(ws, item);
            }
            return;
        }

        // UI client message
        const clientResult = CNSDTOClientMessageSchema.safeParse(data);
        if (!clientResult.success) return;
        const msg = clientResult.data;

        switch (msg.type) {
            case 'client.connect':
                await this.handleClientConnect(ws);
                break;
            case 'apps.query':
                await this.handleAppsQuery(ws, msg.requestId);
                break;
            case 'topology.query':
                await this.handleTopologyQuery(ws, msg.requestId, msg.cnsId, msg.appId);
                break;
            case 'replay.start':
                await this.handleReplayStart(ws, msg);
                break;
            case 'stimulation.retry':
                await this.handleStimulationRetry(ws, msg);
                break;
            case 'stimulation.clone':
                await this.handleStimulationClone(ws, msg);
                break;
            case 'cns.stimulations.query':
                await this.handleRunsQuery(ws, msg);
                break;
        }
    }

    /**
     * Name-based observability (Phase 2b-3): project the durable
     * `ICNSStimulationRepository` into the run/attempt/task roster the panel
     * renders. This replaces the legacy id-based `stimulations.query`/`hops.query`.
     */
    private async handleRunsQuery(ws: WebSocket, msg: any): Promise<void> {
        const stims = await this.stimulationRepository.listStimulations(
            msg.scopeName ? { scopeName: msg.scopeName } : undefined
        );
        const runs = [];
        for (const stim of stims) {
            const attempts = await this.stimulationRepository.getAttempts(
                stim.stimulationId
            );
            const attemptViews = [];
            for (const a of attempts) {
                const tasks = await this.stimulationRepository.getTasks(
                    a.stimulationAttemptId
                );
                attemptViews.push({
                    attemptNumber: a.attemptNumber,
                    status: a.status,
                    hopCount: a.hopCount,
                    startedAt: a.startedAt,
                    completedAt: a.completedAt ?? null,
                    tasks: tasks.map(t => ({
                        index: t.index,
                        neuronName: t.neuronName,
                        dendriteCollateralName: t.dendriteCollateralName,
                        status: t.status,
                        output: t.output
                            ? {
                                  collateralName: t.output.collateralName,
                                  payload: t.output.payload,
                              }
                            : null,
                        error: t.error ?? null,
                        startedAt: t.startedAt,
                        duration: t.duration ?? null,
                    })),
                });
            }
            runs.push({
                runId: stim.stimulationId,
                status: stim.status,
                scopeName: stim.scopeName,
                entry: {
                    collateralName: stim.entry.collateralName,
                    payload: stim.entry.payload,
                },
                frontier: stim.progress.tasks.map(t => t.neuronName),
                attempts: attemptViews,
            });
        }
        this.send(ws, {
            type: 'cns.stimulations.result',
            requestId: msg.requestId,
            runs,
        });
    }

    addClient(ws: WebSocket): void {
        this.uiClients.add(ws);
        if (this.uiClients.size === 1) this.startMetrics();
    }

    removeClient(ws: WebSocket): void {
        this.uiClients.delete(ws);
        this.appSockets.delete(ws);
        if (this.uiClients.size === 0) this.stopMetrics();
    }

    async getActiveApps(): Promise<CNSDTOApp[]> {
        return this.repository.listApps();
    }

    stop(): void {
        this.stopMetrics();
    }

    // ─── App batch item handlers ──────────────────────────────────────────────

    private async handleAppBatchItem(ws: WebSocket, item: any): Promise<void> {
        switch (item.type) {
            case 'topology':
                await this.handleTopology(ws, item);
                break;
            // ── Name-based durable model ──
            case 'cns.stimulation':
                await this.stimulationRepository.saveStimulation(item.data);
                break;
            case 'cns.stimulation.attempt':
                await this.stimulationRepository.saveAttempt(item.data);
                break;
            case 'cns.stimulation.task':
                await this.stimulationRepository.appendTask(item.data);
                break;
        }
    }

    /** The name-based durable store, for tests/integrations that want to read it back. */
    getStimulationRepository(): ICNSStimulationRepository {
        return this.stimulationRepository;
    }

    private async handleTopology(ws: WebSocket, msg: any): Promise<void> {
        const { appId, cnsId, appName, version, timestamp, neurons, collaterals, dendrites } = msg;

        const now = Date.now();
        const app: CNSDTOApp = {
            id: appId,
            name: appName,
            version,
            connectedAt: now,
            lastSeenAt: now,
        };

        await this.repository.upsertApp(app);
        await this.repository.addCnsToApp(appId, cnsId);
        await this.repository.saveTopology({ appId, cnsId, appName, version, timestamp, neurons, collaterals, dendrites });

        // Track app socket
        this.appSockets.set(ws, appId);
        if (!this.appWsByAppId.has(appId)) this.appWsByAppId.set(appId, new Set());
        this.appWsByAppId.get(appId)!.add(ws);

        // Broadcast topology + app connected to UI clients
        const topologyBroadcast = {
            type: 'topology.result' as const,
            requestId: '__broadcast__',
            snapshots: await this.repository.getTopology(cnsId),
        };

        this.broadcast({ type: 'app.connected', app, topology: { cnsId, neurons, collaterals, dendrites } });
        // Also send topology snapshot so UI can refresh graph
        this.broadcastRaw(JSON.stringify(topologyBroadcast));
    }

    // ─── UI client query handlers ─────────────────────────────────────────────

    private async handleClientConnect(ws: WebSocket): Promise<void> {
        this.addClient(ws);
        this.send(ws, { type: 'apps.result', requestId: '__init__', items: await this.repository.listApps() });
        this.send(ws, {
            type: 'topology.result',
            requestId: '__init__',
            snapshots: await this.repository.getTopology(),
        });
    }

    private async handleAppsQuery(ws: WebSocket, requestId: string): Promise<void> {
        const items = await this.repository.listApps();
        this.send(ws, { type: 'apps.result', requestId, items });
    }

    private async handleTopologyQuery(
        ws: WebSocket,
        requestId: string,
        cnsId?: string,
        appId?: string
    ): Promise<void> {
        let snapshots = await this.repository.getTopology(cnsId);
        if (appId) snapshots = snapshots.filter(s => s.appId === appId);
        this.send(ws, { type: 'topology.result', requestId, snapshots });
    }

    private async handleReplayStart(ws: WebSocket, msg: any): Promise<void> {
        const appId = msg.appId ?? (msg.cnsId ? await this.repository.findAppByCns(msg.cnsId) : undefined);
        const appSockets = appId ? this.appWsByAppId.get(appId) : undefined;

        if (!appSockets || appSockets.size === 0) {
            this.send(ws, { type: 'replay.rejected', replayId: msg.replayId, reason: 'App not connected' });
            return;
        }

        const newStimulationId = `${msg.stimulationId}-replay-${Date.now()}`;
        this.send(ws, { type: 'replay.accepted', replayId: msg.replayId, newStimulationId });

        const payload = JSON.stringify(msg);
        for (const appWs of appSockets) {
            try { appWs.send(payload); } catch {}
        }
    }

    // ─── Durable actions (retry / clone), Phase 2b-2 ──────────────────────────────
    //
    // The UI's request is thin (a stimulationId). The CNS + name→ref registry live in
    // the APP, so the server can't execute it: it ENRICHES from the durable store (the
    // stored entry + progress + a server-assigned attempt identity) and forwards a
    // resume/launch command to the owning app, routed by scopeName (= the cns id).

    /** Resolve the app that owns a stimulation's scope, or reject if unreachable. */
    private async resolveScopeApp(
        scopeName: string | undefined
    ): Promise<Set<WebSocket> | undefined> {
        const appId = scopeName
            ? await this.repository.findAppByCns(scopeName)
            : undefined;
        const sockets = appId ? this.appWsByAppId.get(appId) : undefined;
        return sockets && sockets.size > 0 ? sockets : undefined;
    }

    private async handleStimulationRetry(ws: WebSocket, msg: any): Promise<void> {
        const reject = (reason: string) =>
            this.send(ws, {
                type: 'stimulation.retry.rejected',
                requestId: msg.requestId,
                stimulationId: msg.stimulationId,
                reason,
            });

        const stim = await this.stimulationRepository.getStimulation(msg.stimulationId);
        if (!stim) return reject('unknown stimulation');
        if (stim.progress.tasks.length === 0)
            return reject('nothing to resume (empty frontier)');

        const appSockets = await this.resolveScopeApp(stim.scopeName);
        if (!appSockets) return reject('app not connected');

        const attempts = await this.stimulationRepository.getAttempts(msg.stimulationId);
        const nextAttempt = attempts.length + 1;
        const stimulationAttemptId = `${msg.stimulationId}#${nextAttempt}`;

        this.send(ws, {
            type: 'stimulation.retry.accepted',
            requestId: msg.requestId,
            stimulationId: msg.stimulationId,
            newStimulationAttemptId: stimulationAttemptId,
        });

        const payload = JSON.stringify({
            type: 'cns.stimulation.resume',
            requestId: msg.requestId,
            scopeName: stim.scopeName,
            stimulationId: msg.stimulationId,
            stimulationAttemptId,
            attemptNumber: nextAttempt,
            entry: stim.entry,
            progress: stim.progress,
            options: msg.options,
        });
        for (const appWs of appSockets) {
            try { appWs.send(payload); } catch {}
        }
    }

    private async handleStimulationClone(ws: WebSocket, msg: any): Promise<void> {
        const reject = (reason: string) =>
            this.send(ws, {
                type: 'stimulation.clone.rejected',
                requestId: msg.requestId,
                stimulationId: msg.stimulationId,
                reason,
            });

        const stim = await this.stimulationRepository.getStimulation(msg.stimulationId);
        if (!stim) return reject('unknown stimulation');

        const appSockets = await this.resolveScopeApp(stim.scopeName);
        if (!appSockets) return reject('app not connected');

        const newStimulationId = `${msg.stimulationId}-clone-${Date.now()}`;
        const stimulationAttemptId = `${newStimulationId}#1`;

        this.send(ws, {
            type: 'stimulation.clone.accepted',
            requestId: msg.requestId,
            stimulationId: msg.stimulationId,
            newStimulationId,
            newStimulationAttemptId: stimulationAttemptId,
        });

        const payload = JSON.stringify({
            type: 'cns.stimulation.launch',
            requestId: msg.requestId,
            scopeName: stim.scopeName,
            stimulationId: newStimulationId,
            stimulationAttemptId,
            entry: stim.entry,
            options: msg.options,
        });
        for (const appWs of appSockets) {
            try { appWs.send(payload); } catch {}
        }
    }

    // ─── Broadcast helpers ────────────────────────────────────────────────────

    private broadcast(message: object): void {
        this.broadcastRaw(JSON.stringify(message));
    }

    private broadcastRaw(payload: string): void {
        for (const client of this.uiClients) {
            try {
                if ((client as any).readyState === 1) client.send(payload);
            } catch {}
        }
    }

    private send(ws: WebSocket, message: object): void {
        try {
            if ((ws as any).readyState === 1) ws.send(JSON.stringify(message));
        } catch {}
    }

    // ─── Metrics ──────────────────────────────────────────────────────────────

    private startMetrics(): void {
        if (this.metricsTimer) return;
        this.metricsTimer = setInterval(() => {
            const mem = process.memoryUsage();
            const now = Date.now();
            const cpu = process.cpuUsage(this.lastCpuUsage);
            const elapsed = (now - this.lastCpuTime) * 1000;
            const cpuPercent = elapsed > 0 ? ((cpu.user + cpu.system) / elapsed) * 100 : 0;
            this.lastCpuUsage = process.cpuUsage();
            this.lastCpuTime = now;

            this.broadcast({
                type: 'server.metrics',
                timestamp: now,
                rssMB: mem.rss / 1024 / 1024,
                heapUsedMB: mem.heapUsed / 1024 / 1024,
                heapTotalMB: mem.heapTotal / 1024 / 1024,
                cpuPercent,
            });
        }, 1000);
    }

    private stopMetrics(): void {
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = undefined;
        }
    }
}
