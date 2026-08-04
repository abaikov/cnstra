import {
    TCNSAppDTO,
    CNSAppBatchMessageDTOSchema,
    CNSClientMessageDTOSchema,
    TCNSTopologyMessageDTO,
} from '@cnstra/devtools-dto';
import type {
    TCNSStimulationFilter,
    TCNSStimulationTask,
    TCNSStimulationAttempt,
} from '@cnstra/devtools-dto';
import { buildAttemptId, buildCloneId } from '@cnstra/devtools-dto';
import type {
    ICNSStimulationRepository,
    TCNSStimulationRosterFilter,
} from '@cnstra/persist';
import {
    CNSInMemoryStimulationRepository,
    supportsRosterQuery,
    loadRosterEntries,
    keysetPage,
    computeRosterFacets,
} from '@cnstra/persist';
import { WebSocket } from 'ws';

// ─── Repository interface ─────────────────────────────────────────────────────

export type TCNSTopologySnapshotDTO = Omit<TCNSTopologyMessageDTO, 'type'>;

export interface ICNSDevToolsServerRepository {
    // Apps
    upsertApp(app: TCNSAppDTO): void | Promise<void>;
    listApps(): TCNSAppDTO[] | Promise<TCNSAppDTO[]>;

    // Topology
    saveTopology(snapshot: TCNSTopologySnapshotDTO): void | Promise<void>;
    getTopology(cnsId?: string): TCNSTopologySnapshotDTO[] | Promise<TCNSTopologySnapshotDTO[]>;

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
     * Name-based resumable store (Stimulation/Attempt/Task). Written from the three
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
            const result = CNSAppBatchMessageDTOSchema.safeParse(data);
            if (!result.success) return;
            for (const item of result.data.items) {
                await this.handleAppBatchItem(ws, item);
            }
            return;
        }

        // UI client message
        const clientResult = CNSClientMessageDTOSchema.safeParse(data);
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
            case 'cns.stimulations.list':
                await this.handleStimulationsList(ws, msg);
                break;
            case 'cns.stimulations.facets':
                await this.handleStimulationsFacets(ws, msg);
                break;
            case 'cns.stimulations.snapshot':
                await this.handleStimulationsSnapshot(ws, msg);
                break;
            case 'cns.stimulation.detail':
                await this.handleStimulationDetail(ws, msg);
                break;
        }
    }

    /**
     * Explorer protocol (bucket-shaped). The roster row = resumable state minus
     * `progress`, plus envelope summaries derived from the run's attempts.
     *
     * Pushdown: if the store implements `ICNSStimulationRosterQuery` (e.g. the
     * Postgres store), the filter + keyset + GROUP BY run INSIDE it (SQL). Else we
     * fall back to the shared reference derivation over the reader — identical
     * results, only the work moves. Roster shapes are structurally the wire DTOs,
     * so no mapping is needed at the boundary.
     */
    private toRosterFilter(
        scopeName: string | undefined,
        filter: TCNSStimulationFilter | undefined
    ): TCNSStimulationRosterFilter {
        return { ...(filter ?? {}), ...(scopeName ? { scopeName } : {}) };
    }

    private async handleStimulationsList(
        ws: WebSocket,
        msg: any
    ): Promise<void> {
        const filter = this.toRosterFilter(msg.scopeName, msg.filter);
        const limit = typeof msg.limit === 'number' ? msg.limit : 50;
        const opts = { cursor: msg.cursor, limit };
        const store = this.stimulationRepository;
        const page = supportsRosterQuery(store)
            ? await store.queryRoster(filter, opts)
            : keysetPage(
                  (await loadRosterEntries(store, filter)).map(e => e.row),
                  opts
              );
        this.send(ws, {
            type: 'cns.stimulations.list.result',
            requestId: msg.requestId,
            stimulations: page.rows,
            nextCursor: page.nextCursor,
            total: page.total,
        });
    }

    private async handleStimulationsFacets(
        ws: WebSocket,
        msg: any
    ): Promise<void> {
        const filter = this.toRosterFilter(msg.scopeName, msg.filter);
        const store = this.stimulationRepository;
        const facets = supportsRosterQuery(store)
            ? await store.queryFacets(filter, { metricPath: msg.metricPath })
            : computeRosterFacets(await loadRosterEntries(store, filter), {
                  metricPath: msg.metricPath,
              });
        this.send(ws, {
            type: 'cns.stimulations.facets.result',
            requestId: msg.requestId,
            facets,
        });
    }

    private async handleStimulationDetail(
        ws: WebSocket,
        msg: any
    ): Promise<void> {
        const attempts = await this.stimulationRepository.getAttempts(
            msg.stimulationId
        );
        const tasks: TCNSStimulationTask[] = [];
        for (const a of attempts) {
            const ts = await this.stimulationRepository.getTasks(
                a.stimulationAttemptId
            );
            tasks.push(...ts);
        }
        this.send(ws, {
            type: 'cns.stimulation.detail.result',
            requestId: msg.requestId,
            attempts,
            tasks,
        });
    }

    /**
     * The topology/signal views' bulk feed: a bounded, newest-first set of runs as
     * FLAT buckets (stimulations + attempts + tasks) the panel joins client-side by
     * id. Replaces the retired nested `cns.stimulations.query` tree — same data, no
     * server-side join, no client-side flatten.
     */
    private async handleStimulationsSnapshot(
        ws: WebSocket,
        msg: any
    ): Promise<void> {
        const filter = this.toRosterFilter(msg.scopeName, msg.filter);
        const store = this.stimulationRepository;
        const limit = typeof msg.limit === 'number' ? msg.limit : 200;
        const page = supportsRosterQuery(store)
            ? await store.queryRoster(filter, { limit })
            : keysetPage(
                  (await loadRosterEntries(store, filter)).map(e => e.row),
                  { limit }
              );
        const attempts: TCNSStimulationAttempt[] = [];
        const tasks: TCNSStimulationTask[] = [];
        for (const row of page.rows) {
            const as = await store.getAttempts(row.stimulationId);
            attempts.push(...as);
            for (const a of as)
                tasks.push(...(await store.getTasks(a.stimulationAttemptId)));
        }
        this.send(ws, {
            type: 'cns.stimulations.snapshot.result',
            requestId: msg.requestId,
            stimulations: page.rows,
            attempts,
            tasks,
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

    async getActiveApps(): Promise<TCNSAppDTO[]> {
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
            // ── Name-based resumable model ──
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

    /** The name-based resumable store, for tests/integrations that want to read it back. */
    getStimulationRepository(): ICNSStimulationRepository {
        return this.stimulationRepository;
    }

    private async handleTopology(ws: WebSocket, msg: any): Promise<void> {
        const { appId, cnsId, appName, version, timestamp, neurons, collaterals, dendrites } = msg;

        const now = Date.now();
        const app: TCNSAppDTO = {
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

    // ─── Resumable actions (retry / clone), Phase 2b-2 ──────────────────────────────
    //
    // The UI's request is thin (a stimulationId). The CNS + name→ref registry live in
    // the APP, so the server can't execute it: it ENRICHES from the resumable store (the
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
        const stimulationAttemptId = buildAttemptId(msg.stimulationId, nextAttempt);

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

        const newStimulationId = buildCloneId(msg.stimulationId);
        const stimulationAttemptId = buildAttemptId(newStimulationId, 1);

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
