import {
    CNSDTOApp,
    CNSDTOAppBatchMessageSchema,
    CNSDTOClientMessageSchema,
    CNSDTOStimulation,
    CNSDTOStimulationFilter,
    CNSDTOHop,
    CNSDTOTopologyMessage,
} from '@cnstra/devtools-dto';
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

    // Stimulations
    saveStimulation(stimulation: CNSDTOStimulation): void | Promise<void>;
    completeStimulation(
        stimulationId: string,
        completedAt: number,
        hopCount: number,
        hasError: boolean
    ): void | Promise<void>;
    getStimulations(
        appId: string,
        filter: CNSDTOStimulationFilter
    ): { items: CNSDTOStimulation[]; total: number } | Promise<{ items: CNSDTOStimulation[]; total: number }>;

    // Hops
    saveHop(hop: CNSDTOHop): void | Promise<void>;
    getHops(stimulationId: string): CNSDTOHop[] | Promise<CNSDTOHop[]>;

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

    constructor(private readonly repository: ICNSDevToolsServerRepository) {}

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
            case 'stimulations.query':
                await this.handleStimulationsQuery(ws, msg);
                break;
            case 'hops.query':
                await this.handleHopsQuery(ws, msg);
                break;
            case 'replay.start':
                await this.handleReplayStart(ws, msg);
                break;
        }
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
            case 'stimulation.started':
                await this.handleStimulationStarted(ws, item.stimulation);
                break;
            case 'stimulation.hop':
                await this.handleStimulationHop(item.hop);
                break;
            case 'stimulation.completed':
                await this.handleStimulationCompleted(item);
                break;
        }
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

    private async handleStimulationStarted(ws: WebSocket, stimulation: CNSDTOStimulation): Promise<void> {
        // Update lastSeenAt for the app
        const appId = this.appSockets.get(ws);
        if (appId) {
            const apps = await this.repository.listApps();
            const app = apps.find(a => a.id === appId);
            if (app) await this.repository.upsertApp({ ...app, lastSeenAt: Date.now() });
        }

        await this.repository.saveStimulation(stimulation);
        this.broadcast({ type: 'stimulation.started', stimulation });
    }

    private async handleStimulationHop(hop: CNSDTOHop): Promise<void> {
        await this.repository.saveHop(hop);
        this.broadcast({ type: 'stimulation.hop', hop });
    }

    private async handleStimulationCompleted(item: any): Promise<void> {
        await this.repository.completeStimulation(
            item.stimulationId,
            item.completedAt,
            item.hopCount,
            item.hasError
        );
        this.broadcast({
            type: 'stimulation.completed',
            stimulationId: item.stimulationId,
            completedAt: item.completedAt,
            hopCount: item.hopCount,
            hasError: item.hasError,
        });
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

    private async handleStimulationsQuery(ws: WebSocket, msg: any): Promise<void> {
        const appId = msg.appId ?? (msg.cnsId ? await this.repository.findAppByCns(msg.cnsId) : undefined);

        if (!appId) {
            this.send(ws, { type: 'stimulations.result', requestId: msg.requestId, items: [], total: 0, offset: 0 });
            return;
        }

        const { items, total } = await this.repository.getStimulations(appId, msg.filter ?? {});
        this.send(ws, {
            type: 'stimulations.result',
            requestId: msg.requestId,
            items,
            total,
            offset: msg.filter?.offset ?? 0,
        });
    }

    private async handleHopsQuery(ws: WebSocket, msg: any): Promise<void> {
        const items = await this.repository.getHops(msg.stimulationId);
        this.send(ws, { type: 'hops.result', requestId: msg.requestId, items });
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
