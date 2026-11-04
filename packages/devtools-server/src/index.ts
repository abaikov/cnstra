import {
    TCNSAppDTO,
    CNSAppBatchMessageDTOSchema,
    CNSClientMessageDTOSchema,
    CNSDevToolsSyncKeySchemas,
    TCNSTopologyMessageDTO,
} from '@cnstra/devtools-dto';
import type {
    TCNSDevToolsSyncData,
    TCNSDevToolsSyncKeys,
    TCNSStimulationTask,
    TCNSStimulationAttempt,
} from '@cnstra/devtools-dto';
import { CNSHomeostatTransductionEndpoint } from '@cnstra/sync';
import type { TCNSHomeostatTransductionRequest, TCNSHomeostatTransductionRow } from '@cnstra/sync';
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
    keysetPage,
    computeCNSRosterFacets,
} from '@cnstra/persist';
import { randomUUID } from 'crypto';
import type { ICNSDevToolsClient } from './ICNSDevToolsClient';

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
    private appSockets = new Map<ICNSDevToolsClient, string>();
    /** appId → WebSocket[] (one app may have multiple CNS instances) */
    private appWsByAppId = new Map<string, Set<ICNSDevToolsClient>>();
    public readonly homeostatTransductionEndpoint = new CNSHomeostatTransductionEndpoint({
        batchTransduceFn: homeostatTransductionRequests => this.transduce(homeostatTransductionRequests),
    });

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
        private readonly scheduledStimulationReader?: ICNSScheduledStimulationReader,
        private readonly readOnly = false
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
        if (this.readOnly) return 'the devtools are read-only';
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
        ws: ICNSDevToolsClient,
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
            if (ws.role === 'viewer') return;
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
                this.handleClientConnect(ws);
                break;
            case 'sync.request':
                this.send(ws, {
                    type: 'sync.response',
                    requestId: msg.requestId,
                    ...(await this.homeostatTransductionEndpoint.respond(msg.encodedRequests, msg.mediaType)),
                });
                break;
            case 'stimulation.retry':
                await this.handleStimulationRetry(ws, msg);
                break;
            case 'stimulation.clone':
                await this.handleStimulationClone(ws, msg);
                break;
            case 'stimulation.command':
                await this.handleStimulationCommand(ws, msg);
                break;
            case 'stimulation.launch':
                await this.handleStimulationLaunch(ws, msg);
                break;
        }
    }

    private async handleStimulationLaunch(ws: ICNSDevToolsClient, msg: TCNSStimulationLaunchRequest): Promise<void> {
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

    private async handleStimulationCommand(ws: ICNSDevToolsClient, msg: TCNSStimulationCommandRequest): Promise<void> {
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

    removeClient(ws: ICNSDevToolsClient): void {
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
    }

    async getActiveApps(scopeName?: string): Promise<TCNSAppDTO[]> {
        return CNSDevToolsServer.appsOf(await this.repository.getTopology(scopeName));
    }

    private static appsOf(snapshots: readonly TCNSTopologySnapshotDTO[]): TCNSAppDTO[] {
        const latest = new Map<string, TCNSTopologySnapshotDTO>();
        for (const snapshot of snapshots) {
            const known = latest.get(snapshot.appId);
            if (!known || snapshot.timestamp > known.timestamp) latest.set(snapshot.appId, snapshot);
        }
        return [...latest.values()].map(snapshot => ({ id: snapshot.appId, name: snapshot.appName, version: snapshot.version }));
    }

    // ─── App batch item handlers ──────────────────────────────────────────────

    private async handleAppBatchItem(ws: ICNSDevToolsClient, item: any): Promise<void> {
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

    private async handleTopology(ws: ICNSDevToolsClient, msg: any): Promise<void> {
        const { appId, cnsId, appName, version, timestamp, neurons, collaterals, dendrites } = msg;

        await this.repository.saveTopology({ appId, cnsId, appName, version, timestamp, neurons, collaterals, dendrites });

        // Track app socket
        this.appSockets.set(ws, appId);
        if (!this.appWsByAppId.has(appId)) this.appWsByAppId.set(appId, new Set());
        this.appWsByAppId.get(appId)!.add(ws);
    }

    private handleClientConnect(ws: ICNSDevToolsClient): void {
        this.send(ws, {
            type: 'ui.config',
            // Five minutes unless told otherwise: the panel opens on what is
            // happening now, not on everything that ever happened.
            defaultWindowMs: this.ui.defaultWindowMs ?? 5 * 60_000,
            ...this.ui,
        });
    }

    private async transduce(
        homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]
    ): Promise<TCNSHomeostatTransductionRow[]> {
        const detailRequests = homeostatTransductionRequests.filter(request => request.name === 'stimulationDetail');
        const rows = await Promise.all(
            homeostatTransductionRequests
                .filter(request => request.name !== 'stimulationDetail')
                .map(request => this.transduceOne(request))
        );
        return [...rows, ...(await this.transduceDetails(detailRequests))];
    }

    private async transduceOne({ name, key }: TCNSHomeostatTransductionRequest): Promise<TCNSHomeostatTransductionRow> {
        try {
            return { name, key, data: await this.readSync(name, key) };
        } catch (error) {
            return { name, key, error };
        }
    }

    private readSync(name: string, key: readonly unknown[]): Promise<unknown> {
        switch (name) {
            case 'apps': {
                const [scopeName] = CNSDevToolsSyncKeySchemas.apps.parse(key);
                return this.getActiveApps(scopeName).then(apps => ({ apps }));
            }
            case 'topology':
                return this.readTopology(CNSDevToolsSyncKeySchemas.topology.parse(key));
            case 'stimulationPage':
                return this.readStimulationPage(CNSDevToolsSyncKeySchemas.stimulationPage.parse(key));
            case 'stimulationFacets':
                return this.readStimulationFacets(CNSDevToolsSyncKeySchemas.stimulationFacets.parse(key));
            case 'stimulationSnapshot':
                return this.readStimulationSnapshot(CNSDevToolsSyncKeySchemas.stimulationSnapshot.parse(key));
            case 'scheduledPage':
                return this.readScheduledPage(CNSDevToolsSyncKeySchemas.scheduledPage.parse(key));
            default:
                return Promise.reject(new Error(`no sync receptor named ${name}`));
        }
    }

    private async readTopology([scopeName]: TCNSDevToolsSyncKeys['topology']): Promise<TCNSDevToolsSyncData['topology']> {
        const snapshots = await this.repository.getTopology(scopeName);
        return {
            neurons: snapshots.flatMap(snapshot => snapshot.neurons),
            collaterals: snapshots.flatMap(snapshot => snapshot.collaterals),
            dendrites: snapshots.flatMap(snapshot => snapshot.dendrites),
        };
    }

    private static rosterFilterOf(
        [scopeName, status, entryCollateralName, neuronName, text, since, until]: TCNSDevToolsSyncKeys['stimulationSnapshot']
            | TCNSDevToolsSyncKeys['stimulationPage']
            | TCNSDevToolsSyncKeys['stimulationFacets']
    ): TCNSStimulationRosterFilter {
        return { scopeName, status, entryCollateralName, neuronName, text, since, until };
    }

    private async readRosterPage(
        filter: TCNSStimulationRosterFilter,
        options: { cursor?: string; sinceCursor?: string; limit: number }
    ): Promise<TCNSDevToolsSyncData['stimulationPage']> {
        const store = this.stimulationRepository;
        return supportsCNSRosterQuery(store)
            ? store.queryRoster(filter, options)
            : keysetPage((await loadCNSRosterEntries(store, filter)).map(entry => entry.row), options);
    }

    private readStimulationPage(key: TCNSDevToolsSyncKeys['stimulationPage']): Promise<TCNSDevToolsSyncData['stimulationPage']> {
        const [, , , , , , , sinceCursor, cursor, limit] = key;
        return this.readRosterPage(CNSDevToolsServer.rosterFilterOf(key), { sinceCursor, cursor, limit });
    }

    private async readStimulationFacets(key: TCNSDevToolsSyncKeys['stimulationFacets']): Promise<TCNSDevToolsSyncData['stimulationFacets']> {
        const [, , , , , , , metricPath] = key;
        const filter = CNSDevToolsServer.rosterFilterOf(key);
        const store = this.stimulationRepository;
        return supportsCNSRosterQuery(store)
            ? store.queryFacets(filter, { metricPath })
            : computeCNSRosterFacets(await loadCNSRosterEntries(store, filter), { metricPath });
    }

    private async readStimulationSnapshot(key: TCNSDevToolsSyncKeys['stimulationSnapshot']): Promise<TCNSDevToolsSyncData['stimulationSnapshot']> {
        const [, , , , , , , limit] = key;
        return { stimulations: (await this.readRosterPage(CNSDevToolsServer.rosterFilterOf(key), { limit })).rows };
    }

    private async readScheduledPage(
        [neuronName, collateralName, cursor, limit]: TCNSDevToolsSyncKeys['scheduledPage']
    ): Promise<TCNSDevToolsSyncData['scheduledPage']> {
        const reader = this.scheduledStimulationReader;
        if (!reader) return { available: false, rows: [], schedules: [], types: [], nextCursor: null };
        return { available: true, ...(await reader.list({ neuronName, collateralName }, cursor ?? null, limit)) };
    }

    private async transduceDetails(
        homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]
    ): Promise<TCNSHomeostatTransductionRow[]> {
        const rows: TCNSHomeostatTransductionRow[] = [];
        const stimulationIds: string[] = [];
        const readRequests: TCNSHomeostatTransductionRequest[] = [];
        for (const request of homeostatTransductionRequests) {
            const parsed = CNSDevToolsSyncKeySchemas.stimulationDetail.safeParse(request.key);
            if (!parsed.success) rows.push({ ...request, error: parsed.error });
            else {
                stimulationIds.push(parsed.data[0]);
                readRequests.push(request);
            }
        }
        if (readRequests.length === 0) return rows;
        try {
            const store = this.stimulationRepository;
            const attempts: TCNSStimulationAttempt[] = store.getAttemptsFor
                ? await store.getAttemptsFor(stimulationIds)
                : (await Promise.all(stimulationIds.map(id => store.getAttempts(id)))).flat();
            const attemptIds = attempts.map(attempt => attempt.stimulationAttemptId);
            const tasks: TCNSStimulationTask[] = store.getTasksFor
                ? await store.getTasksFor(attemptIds)
                : (await Promise.all(attemptIds.map(id => store.getTasks(id)))).flat();
            const detailById = new Map<string, TCNSDevToolsSyncData['stimulationDetail']>(stimulationIds.map(id => [id, { attempts: [], tasks: [] }]));
            const detailByAttemptId = new Map<string, TCNSDevToolsSyncData['stimulationDetail']>();
            for (const attempt of attempts) {
                const detail = detailById.get(attempt.stimulationId);
                if (detail === undefined) continue;
                detail.attempts.push(attempt);
                detailByAttemptId.set(attempt.stimulationAttemptId, detail);
            }
            for (const task of tasks) detailByAttemptId.get(task.stimulationAttemptId)?.tasks.push(task);
            readRequests.forEach((request, index) => rows.push({ ...request, data: detailById.get(stimulationIds[index]) }));
        } catch (error) {
            for (const request of readRequests) rows.push({ ...request, error });
        }
        return rows;
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
    ): Promise<Set<ICNSDevToolsClient> | undefined> {
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
    private liveSockets(appId: string): Set<ICNSDevToolsClient> | undefined {
        const sockets = this.appWsByAppId.get(appId);
        if (!sockets || sockets.size === 0) return undefined;
        const open = new Set<ICNSDevToolsClient>();
        for (const ws of sockets) {
            if (ws.readyState === 1) open.add(ws);
        }
        return open.size > 0 ? open : undefined;
    }

    private async handleStimulationRetry(ws: ICNSDevToolsClient, msg: any): Promise<void> {
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

    private async handleStimulationClone(ws: ICNSDevToolsClient, msg: any): Promise<void> {
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

    private send(ws: ICNSDevToolsClient, message: object): void {
        try {
            if (ws.readyState === 1) ws.send(JSON.stringify(message));
        } catch {}
    }


}

export { CNSDevToolsPollingTransport } from './pollingTransport';
export type {
    TCNSPollingOptions,
    ICNSPollingSession,
} from './pollingTransport';
export { startCNSDevTools } from './start';
export type { TCNSDevToolsStartOptions, TCNSDevToolsHandle } from './start';
export { createCNSDevToolsHandler } from './createCNSDevToolsHandler';
export type { TCNSDevToolsHandler } from './TCNSDevToolsHandler';
export type { TCNSDevToolsHandlerOptions } from './TCNSDevToolsHandlerOptions';
export type { TCNSDevToolsSource } from './TCNSDevToolsSource';
export type { TCNSDevToolsWebSocketOptions } from './TCNSDevToolsWebSocketOptions';
export { CNSDevToolsInProcessTransport } from './CNSDevToolsInProcessTransport';
export { CNSDevToolsLocalRequestPolicy } from './CNSDevToolsLocalRequestPolicy';
export type { ICNSDevToolsClient } from './ICNSDevToolsClient';
export type { TCNSDevToolsClientRole } from './TCNSDevToolsClientRole';
