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
import { buildCNSAttemptId, buildCNSCloneId } from '@cnstra/devtools-dto';
import type {
    ICNSStimulationRepository,
    TCNSStimulationRosterFilter,
} from '@cnstra/persist';
import { runCNSDevToolsAction } from '@cnstra/persist-dto';
import type {
    ICNSScheduledStimulationReader,
    TCNSDevToolsAction,
    TCNSDevToolsActionMiddleware,
    TCNSScheduledStimulationFilter,
    TCNSStimulationCommandAccepted,
    TCNSStimulationCommandRejected,
    TCNSStimulationCommandRequest,
    TCNSStimulationLaunchAccepted,
    TCNSStimulationLaunchRejected,
    TCNSStimulationLaunchRequest,
} from '@cnstra/persist-dto';
import {
    CNSInMemoryStimulationRepository,
    supportsCNSRosterQuery,
    loadCNSRosterEntries,
    cnsKeysetPage,
    computeCNSRosterFacets,
} from '@cnstra/persist';
import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';

// ─── Repository interface ─────────────────────────────────────────────────────

export type TCNSTopologySnapshotDTO = Omit<TCNSTopologyMessageDTO, 'type'>;

/** Server-side switches the panel reads on connect. */
export type TCNSUiConfig = {
    /** Which run actions the panel may offer. Unset ⇒ allowed. */
    actions?: { retry?: boolean; clone?: boolean };
    /**
     * How far back the panel looks when it opens, in milliseconds. Defaults to
     * five minutes; `0` opens on the whole history.
     *
     * The Explorer is time-ordered throughout, and an unbounded first query makes
     * the store aggregate everything it holds to show one page. This is the knob
     * for a deployment whose history is large — or small enough not to bother.
     */
    defaultWindowMs?: number;
};

export interface ICNSDevToolsServerRepository {
    saveTopology(snapshot: TCNSTopologySnapshotDTO): void | Promise<void>;
    getTopology(cnsId?: string): TCNSTopologySnapshotDTO[] | Promise<TCNSTopologySnapshotDTO[]>;

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

    /**
     * Links that carry out a panel action (Retry / Clone / Launch), in order.
     *
     * The runs a panel shows do not all come from the same place: some are queue
     * jobs, some were started by an HTTP handler, some by a cron. A link that owns
     * a run acts and stops the chain; one that does not calls `next()`. Wrapping a
     * built-in — to log, authorize, or refuse — is the same mechanism.
     *
     * The server appends its own link LAST: forwarding over the app's socket, the
     * only way to reach a plain in-process CNS with no broker. So an empty chain
     * behaves exactly as before.
     */
    private readonly actions: readonly TCNSDevToolsActionMiddleware[];

    /**
     * What the panel may offer, handed to it on connect.
     *
     * Retry and Clone are different operations: Retry continues the SAME run and
     * updates its record in place, Clone starts a new run and leaves the original
     * alone. A deployment that must never overwrite a record turns Retry off; one
     * that must not multiply run ids turns Clone off. Unset means allowed.
     */
    private readonly ui: TCNSUiConfig;

    constructor(
        private readonly repository: ICNSDevToolsServerRepository,
        stimulationRepository: ICNSStimulationRepository = new CNSInMemoryStimulationRepository(),
        actions: readonly TCNSDevToolsActionMiddleware[] = [],
        ui: TCNSUiConfig = {},
        private readonly scheduledStimulationReader?: ICNSScheduledStimulationReader
    ) {
        this.stimulationRepository = stimulationRepository;
        this.actions = [...actions, this.createSocketAction()];
        this.ui = ui;
    }

    /**
     * Run an action through the chain and flatten the three outcomes into one
     * value: `true` acted, `false` nobody took it, a string is the reason a link
     * failed. A link that throws must not escape into the socket's message
     * handler, where nothing answers the panel.
     */
    private async carryOut(
        action: TCNSDevToolsAction
    ): Promise<true | false | string> {
        try {
            return (await runCNSDevToolsAction(this.actions, action)) || false;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    /**
     * The fallback link: forward the action to the app over its own socket. This
     * is what reaches a CNS running in-process with no queue behind it — and it
     * is why the chain always ends here rather than rejecting.
     */
    private createSocketAction(): TCNSDevToolsActionMiddleware {
        return async (action, next) => {
            if (action.type === 'command') return next();
            const appSockets = await this.resolveScopeApp(action.scopeName);
            if (!appSockets) return next();

            const payload =
                action.type === 'resume'
                    ? JSON.stringify({
                          type: 'cns.stimulation.resume',
                          requestId: action.requestId,
                          scopeName: action.scopeName,
                          stimulationId: action.stimulationId,
                          stimulationAttemptId: action.stimulationAttemptId,
                          attemptNumber: action.attemptNumber,
                          entry: action.entry,
                          progress: action.progress,
                          replayOf: action.replayOf,
                          options: action.options,
                      })
                    : JSON.stringify({
                          type: 'cns.stimulation.launch',
                          requestId: action.requestId,
                          scopeName: action.scopeName,
                          stimulationId: action.stimulationId,
                          stimulationAttemptId: action.stimulationAttemptId,
                          entry: action.entry,
                          replayOf: action.replayOf,
                          options: action.options,
                      });

            for (const appWs of appSockets) {
                try {
                    appWs.send(payload);
                } catch {}
            }
        };
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
            case 'cns.scheduled.list':
                await this.handleScheduledStimulationsList(ws, msg);
                break;
            case 'stimulation.command':
                await this.handleStimulationCommand(ws, msg);
                break;
            case 'stimulation.launch':
                await this.handleStimulationLaunch(ws, msg);
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
        const page = supportsCNSRosterQuery(store)
            ? await store.queryRoster(filter, opts)
            : cnsKeysetPage(
                  (await loadCNSRosterEntries(store, filter)).map(e => e.row),
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
        const facets = supportsCNSRosterQuery(store)
            ? await store.queryFacets(filter, { metricPath: msg.metricPath })
            : computeCNSRosterFacets(await loadCNSRosterEntries(store, filter), {
                  metricPath: msg.metricPath,
              });
        this.send(ws, {
            type: 'cns.stimulations.facets.result',
            requestId: msg.requestId,
            facets,
        });
    }

    private async handleStimulationLaunch(ws: WebSocket, msg: TCNSStimulationLaunchRequest): Promise<void> {
        const newStimulationId = `${msg.entry.collateralName}-${randomUUID()}`;
        const handled = await this.carryOut({
            type: 'launch',
            requestId: msg.requestId,
            stimulationId: newStimulationId,
            stimulationAttemptId: buildCNSAttemptId(newStimulationId, 1),
            entry: msg.entry,
        });
        if (handled === true) {
            this.send(ws, { type: 'stimulation.launch.accepted', requestId: msg.requestId, newStimulationId } satisfies TCNSStimulationLaunchAccepted);
            return;
        }
        this.send(ws, {
            type: 'stimulation.launch.rejected',
            requestId: msg.requestId,
            reason: handled === false ? 'no runtime accepted the launch' : handled,
        } satisfies TCNSStimulationLaunchRejected);
    }

    private async handleStimulationCommand(ws: WebSocket, msg: TCNSStimulationCommandRequest): Promise<void> {
        const handled = await this.carryOut({
            type: 'command',
            requestId: msg.requestId,
            stimulationId: msg.stimulationId,
            command: msg.command,
        });
        if (handled === true) {
            this.send(ws, { type: 'stimulation.command.accepted', requestId: msg.requestId, stimulationId: msg.stimulationId } satisfies TCNSStimulationCommandAccepted);
            return;
        }
        this.send(ws, {
            type: 'stimulation.command.rejected',
            requestId: msg.requestId,
            stimulationId: msg.stimulationId,
            reason: handled === false ? `no runtime accepted the ${msg.command.name} command` : handled,
        } satisfies TCNSStimulationCommandRejected);
    }

    private async handleScheduledStimulationsList(
        ws: WebSocket,
        msg: { requestId: string; filter?: TCNSScheduledStimulationFilter; cursor?: string; limit?: number }
    ): Promise<void> {
        const reader = this.scheduledStimulationReader;
        const page = reader
            ? await reader.list(msg.filter ?? {}, msg.cursor ?? null, msg.limit ?? 50)
            : { rows: [], schedules: [], types: [], nextCursor: null };
        this.send(ws, {
            type: 'cns.scheduled.list.result',
            requestId: msg.requestId,
            available: reader !== undefined,
            ...page,
        });
    }

    private async handleStimulationDetail(
        ws: WebSocket,
        msg: any
    ): Promise<void> {
        const attempts = await this.stimulationRepository.getAttempts(
            msg.stimulationId
        );
        // One read, the way the snapshot handler already does it — this looped
        // per attempt while the bulk method sat two methods away.
        const attemptIds = attempts.map(a => a.stimulationAttemptId);
        const store = this.stimulationRepository;
        const tasks: TCNSStimulationTask[] = store.getTasksFor
            ? await store.getTasksFor(attemptIds)
            : (
                  await Promise.all(
                      attemptIds.map(id => store.getTasks(id))
                  )
              ).flat();
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
        const page = supportsCNSRosterQuery(store)
            ? await store.queryRoster(filter, { limit })
            : cnsKeysetPage(
                  (await loadCNSRosterEntries(store, filter)).map(e => e.row),
                  { limit }
              );
        // Two calls, not two per run. The page can be hundreds of runs with
        // several attempts each; asking per id turned one snapshot into hundreds
        // of round trips whose count grew with the page rather than the data.
        //
        // And only for the runs the caller does not already hold. The rows
        // themselves always go in full — they are what says a run moved — but a
        // finished run's tasks never change, and re-reading and re-sending them
        // every two seconds is the whole payload.
        const skip = new Set(
            Array.isArray(msg.skipDetailFor) ? msg.skipDetailFor : []
        );
        const ids = page.rows
            .map(row => row.stimulationId)
            .filter(id => !skip.has(id));
        const attempts: TCNSStimulationAttempt[] = store.getAttemptsFor
            ? await store.getAttemptsFor(ids)
            : (
                  await Promise.all(ids.map(id => store.getAttempts(id)))
              ).flat();

        const attemptIds = attempts.map(a => a.stimulationAttemptId);
        const tasks: TCNSStimulationTask[] = store.getTasksFor
            ? await store.getTasksFor(attemptIds)
            : (
                  await Promise.all(attemptIds.map(id => store.getTasks(id)))
              ).flat();
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

        // An app socket is registered in TWO places (appSockets + the per-app
        // routing set). Forgetting the second one made `resolveScopeApp` keep
        // reporting a dead app as reachable: retry/clone were ACCEPTED and then
        // written into a closed socket, and the set grew by one corpse per
        // reconnect.
        const appId = this.appSockets.get(ws);
        this.appSockets.delete(ws);
        if (appId !== undefined) {
            const sockets = this.appWsByAppId.get(appId);
            if (sockets) {
                sockets.delete(ws);
                if (sockets.size === 0) this.appWsByAppId.delete(appId);
            }
        }

        if (this.uiClients.size === 0) this.stopMetrics();
    }

    async getActiveApps(): Promise<TCNSAppDTO[]> {
        return CNSDevToolsServer.appsOf(await this.repository.getTopology());
    }

    private static appsOf(snapshots: readonly TCNSTopologySnapshotDTO[]): TCNSAppDTO[] {
        const latest = new Map<string, TCNSTopologySnapshotDTO>();
        for (const snapshot of snapshots) {
            const known = latest.get(snapshot.appId);
            if (!known || snapshot.timestamp > known.timestamp) latest.set(snapshot.appId, snapshot);
        }
        return [...latest.values()].map(snapshot => ({ id: snapshot.appId, name: snapshot.appName, version: snapshot.version }));
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

        this.broadcast({ type: 'app.connected', app: { id: appId, name: appName, version }, topology: { cnsId, neurons, collaterals, dendrites } });
        // Also send topology snapshot so UI can refresh graph
        this.broadcastRaw(JSON.stringify(topologyBroadcast));
    }

    // ─── UI client query handlers ─────────────────────────────────────────────

    private async handleClientConnect(ws: WebSocket): Promise<void> {
        this.addClient(ws);
        // First, so the panel knows which actions to draw before any run arrives.
        this.send(ws, {
            type: 'ui.config',
            // Five minutes unless told otherwise: the panel opens on what is
            // happening now, not on everything that ever happened.
            defaultWindowMs: this.ui.defaultWindowMs ?? 5 * 60_000,
            ...this.ui,
        });
        const snapshots = await this.repository.getTopology();
        this.send(ws, { type: 'apps.result', requestId: '__init__', items: CNSDevToolsServer.appsOf(snapshots) });
        this.send(ws, { type: 'topology.result', requestId: '__init__', snapshots });
    }

    private async handleAppsQuery(ws: WebSocket, requestId: string): Promise<void> {
        this.send(ws, { type: 'apps.result', requestId, items: await this.getActiveApps() });
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
        return appId ? this.liveSockets(appId) : undefined;
    }

    /**
     * Sockets of `appId` that can still receive a command, or `undefined` when
     * none can. `close` is not always dispatched before we route (a half-dead
     * socket, an embedding that never calls `removeClient`), so being registered
     * is not proof of being reachable — readyState is.
     */
    private liveSockets(appId: string): Set<WebSocket> | undefined {
        const sockets = this.appWsByAppId.get(appId);
        if (!sockets || sockets.size === 0) return undefined;
        const open = new Set<WebSocket>();
        for (const ws of sockets) {
            if ((ws as any).readyState === 1) open.add(ws);
        }
        return open.size > 0 ? open : undefined;
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

        // No connectivity check here any more: whether anything can carry the
        // action out is the chain's answer, and a broker link needs no connected
        // app at all. The socket link is simply its last resort.
        const attempts = await this.stimulationRepository.getAttempts(msg.stimulationId);
        // The next attempt number is one past the HIGHEST attempt, not one past
        // the COUNT: retention may have pruned attempt 1 (leaving 2,3 → count 2
        // → a collision with the live attempt 3), and two panels reading the
        // same array would otherwise mint the same id twice.
        const latest = attempts.reduce<TCNSStimulationAttempt | undefined>(
            (max, a) => (!max || a.attemptNumber > max.attemptNumber ? a : max),
            undefined
        );
        const nextAttempt = (latest?.attemptNumber ?? 0) + 1;
        const stimulationAttemptId = buildCNSAttemptId(msg.stimulationId, nextAttempt);

        // Accept only once something has taken the action — telling the panel
        // "accepted" and then "rejected" for one click is worse than either.
        //
        // A link may also THROW: a second, concurrent Retry reaches BullMQ's
        // `job.retry()` on a job that has already left the failed set, and it
        // rejects rather than queueing the run twice. That is the right outcome,
        // but the person who clicked has to be told — an escaping exception
        // leaves the panel with no answer at all.
        const handled = await this.carryOut({
            type: 'resume',
            requestId: msg.requestId,
            scopeName: stim.scopeName,
            stimulationId: msg.stimulationId,
            stimulationAttemptId,
            attemptNumber: nextAttempt,
            entry: stim.entry,
            progress: stim.progress,
            // Provenance: which attempt this retry continues from.
            replayOf: latest?.stimulationAttemptId,
            options: msg.options,
        });
        // Nobody could carry it out. Saying so beats a button that reports
        // "accepted" and then does nothing.
        if (handled !== true) {
            return reject(
                handled === false
                    ? 'no runtime accepted the retry'
                    : `retry failed: ${handled}`
            );
        }

        this.send(ws, {
            type: 'stimulation.retry.accepted',
            requestId: msg.requestId,
            stimulationId: msg.stimulationId,
            newStimulationAttemptId: stimulationAttemptId,
        });
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

        const newStimulationId = buildCNSCloneId(msg.stimulationId);
        const stimulationAttemptId = buildCNSAttemptId(newStimulationId, 1);
        // `replayOf` is an ATTEMPT id by contract, so the provenance of a clone is
        // the source run's latest attempt — not the source stimulation id.
        const sourceAttempts = await this.stimulationRepository.getAttempts(
            msg.stimulationId
        );
        // Highest attempt, not last-in-array: `getAttempts` ordering is not part
        // of the repository contract, and only the in-memory store happens to
        // sort ascending.
        const replayOf = sourceAttempts.reduce<TCNSStimulationAttempt | undefined>(
            (max, a) => (!max || a.attemptNumber > max.attemptNumber ? a : max),
            undefined
        )?.stimulationAttemptId;

        // Same as retry: accept only after something took the action, and a
        // throwing link is reported rather than lost.
        const handled = await this.carryOut({
            type: 'launch',
            requestId: msg.requestId,
            scopeName: stim.scopeName,
            stimulationId: newStimulationId,
            stimulationAttemptId,
            entry: stim.entry,
            // A clone gets a NEW stimulationId, so this is the ONLY link back to
            // the run it came from.
            replayOf,
            options: msg.options,
        });
        if (handled !== true) {
            return reject(
                handled === false
                    ? 'no runtime accepted the clone'
                    : `clone failed: ${handled}`
            );
        }

        this.send(ws, {
            type: 'stimulation.clone.accepted',
            requestId: msg.requestId,
            stimulationId: msg.stimulationId,
            newStimulationId,
            newStimulationAttemptId: stimulationAttemptId,
        });
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

export { CNSDevToolsPollingTransport } from './pollingTransport';
export type {
    TCNSPollingOptions,
    ICNSPollingSession,
} from './pollingTransport';
export { startCNSDevTools } from './start';
export type { TCNSDevToolsStartOptions, TCNSDevToolsHandle } from './start';
