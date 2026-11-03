import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import type {
    CNSExplorerWsClient,
    TCNSExplorerDetail,
    TCNSExplorerScheduled,
    TCNSExplorerSnapshot,
    TCNSExplorerTopology,
} from './explorerClient';
import { CNSScheduledPager } from './CNSScheduledPager';
import { CNSSnapshotCache } from './CNSSnapshotCache';
import {
    DEFAULT_QUERY,
    encodeQuery,
    decodeQuery,
    withPatch,
    type TCNSExplorerQuery,
} from './queryState';
import type {
    TCNSStimulationRowDTO,
    TCNSStimulationFacetsDTO,
} from '@cnstra/devtools-dto';
import type { TCNSStimulationCommand } from '@cnstra/persist-dto';

/** An entity the DETAILS panel can show — one crumb in the navigation stack. */
export type TCNSNavKind = 'stimulation' | 'neuron' | 'collateral' | 'task';
export type TCNSNavEntry = {
    kind: TCNSNavKind;
    /** The entity id/name (stimulationId, neuronName, collateralName, task key). */
    id: string;
    /** Human label for the breadcrumb crumb. */
    label: string;
};

// The explorer's data-layer: owns the query-state (⇄ URL) and everything projected
// from it (roster rows, facet counts, selected-run detail). The UI (slice 3) only
// reads these bindables and dispatches patches — no fetching in the view.

export type TCNSExplorerControllerOptions = {
    /** Pre-set which actions are allowed; the socket pushes the real ones on connect. */
    allowedActions?: { retry?: boolean; clone?: boolean };
    /** Read/write the URL query string (so the query round-trips + is shareable). */
    readSearch?: () => string;
    writeSearch?: (search: string) => void;
    /** Live-tail interval for page-1 + facets (0 disables). */
    liveMs?: number;
    /** Page size. */
    limit?: number;
};

export type TCNSExplorerController = {
    query: TExoWritableBindable<TCNSExplorerQuery, TCNSExplorerQuery>;
    rows: TExoWritableBindable<TCNSStimulationRowDTO[], TCNSStimulationRowDTO[]>;
    facets: TExoWritableBindable<TCNSStimulationFacetsDTO, TCNSStimulationFacetsDTO>;
    detail: TExoWritableBindable<TCNSExplorerDetail | null, TCNSExplorerDetail | null>;
    /** Lightweight topology (neurons/collaterals/dendrites) — feeds Neurons/Collaterals. */
    topology: TExoWritableBindable<TCNSExplorerTopology, TCNSExplorerTopology>;
    /** Bounded newest-first run set as flat buckets — feeds Tasks + client aggregates. */
    snapshot: TExoWritableBindable<TCNSExplorerSnapshot, TCNSExplorerSnapshot>;
    /** A NEURON-scoped snapshot: the selected neuron's full RECENT activation history
     *  (a server snapshot filtered by neuronName, larger than the global one). Null
     *  when no neuron is open — the detail then falls back to the global snapshot. */
    neuronScope: TExoWritableBindable<
        TCNSExplorerSnapshot | null,
        TCNSExplorerSnapshot | null
    >;
    scheduled: TExoWritableBindable<TCNSExplorerScheduled, TCNSExplorerScheduled>;
    scopedScheduled: TExoWritableBindable<TCNSExplorerScheduled | null, TCNSExplorerScheduled | null>;
    loadMoreScheduled: () => Promise<void>;
    loadMoreScopedScheduled: () => Promise<void>;
    commandScheduled: (stimulationId: string, command: TCNSStimulationCommand) => Promise<void>;
    launchScheduled: (collateralName: string, payload: unknown) => Promise<void>;
    now: TExoWritableBindable<number, number>;
    loading: TExoWritableBindable<boolean, boolean>;
    total: TExoWritableBindable<number, number>;
    hasMore: TExoWritableBindable<boolean, boolean>;
    /** Patch the query (updates URL, refetches list+facets+snapshot, resets the page). */
    setQuery: (patch: Partial<TCNSExplorerQuery>) => void;
    /** Append the next page (infinite scroll). */
    loadMore: () => Promise<void>;
    /** Select a run → fetch its attempts/tasks (fills the details split-panel). */
    selectRun: (stimulationId: string) => Promise<void>;
    /** Breadcrumb navigation stack of visited detail entities (top = shown). */
    navStack: TExoWritableBindable<TCNSNavEntry[], TCNSNavEntry[]>;
    /** Open an entity in the details panel. `fresh` resets the stack (list click); else push. */
    openEntity: (entry: TCNSNavEntry, fresh?: boolean) => void;
    /** Go back one crumb (or clear the details panel when at the root). */
    navBack: () => void;
    /** Jump to a crumb by index (truncates the stack). */
    navTo: (index: number) => void;
    /** Clear the details panel + nav stack (e.g. on a tab switch). */
    clearNav: () => void;
    /** Resume a run's frontier (retry) — then refresh the roster + detail. */
    retryRun: (stimulationId: string) => Promise<void>;
    /** Clone a run from its entry — then refresh the roster. */
    cloneRun: (stimulationId: string) => Promise<void>;
    /**
     * Open on the last `windowMs` unless the user already picked a range.
     *
     * Called once when the server's config arrives. It does NOT overwrite a
     * `since` that came from the URL — a shared link must land where it says,
     * and a window that reasserted itself would silently move someone off the
     * run they were sent to look at.
     */
    applyDefaultWindow(windowMs: number | undefined): void;
    /**
     * Which run actions this server allows. An absent flag means allowed, so a
     * server that says nothing leaves both buttons as they were.
     *
     * Retry and Clone are different operations, not two spellings of one: Retry
     * continues the SAME run and updates its record in place; Clone starts a new
     * run from the same entry and leaves the original untouched. A deployment
     * that must never overwrite a record turns Retry off; one that must not
     * multiply run ids turns Clone off.
     */
    allowedActions: TExoWritableBindable<
        { retry?: boolean; clone?: boolean },
        { retry?: boolean; clone?: boolean }
    >;
    /**
     * The action in flight, if any — `'retry'` or `'clone'`.
     *
     * The button reads it and goes disabled while it is set. Without that the
     * click gives no feedback, and a second click sends a second command: the
     * server would mint the same attempt id twice and, on a runtime with no
     * queue behind it, run the resumed frontier twice.
     */
    actionPending: TExoWritableBindable<string | null, string | null>;
    /** Last retry/clone error message (cleared on the next action), for the UI. */
    actionError: TExoWritableBindable<string | null, string | null>;
    /** Last retry/clone SUCCESS message (transient toast, auto-clears), for the UI. */
    actionNotice: TExoWritableBindable<string | null, string | null>;
    start: () => void;
    stop: () => void;
};

export function createExplorerController(
    client: CNSExplorerWsClient,
    opts: TCNSExplorerControllerOptions = {}
): TCNSExplorerController {
    const limit = opts.limit ?? 50;
    const query = bindable<TCNSExplorerQuery>(
        opts.readSearch ? decodeQuery(opts.readSearch()) : DEFAULT_QUERY
    );
    const rows = bindable<TCNSStimulationRowDTO[]>([]);
    const facets = bindable<TCNSStimulationFacetsDTO>({
        byEntryCollateral: [],
        byStatus: [],
        byNeuron: [],
        byTime: [],
    });
    const detail = bindable<TCNSExplorerDetail | null>(null);
    const topology = bindable<TCNSExplorerTopology>({
        neurons: [],
        collaterals: [],
        dendrites: [],
    });
    const snapshot = bindable<TCNSExplorerSnapshot>({
        stimulations: [],
        attempts: [],
        tasks: [],
    });
    const neuronScope = bindable<TCNSExplorerSnapshot | null>(null);
    const emptyScheduled: TCNSExplorerScheduled = { available: false, rows: [], schedules: [], types: [], nextCursor: null };
    const scheduled = bindable<TCNSExplorerScheduled>(emptyScheduled);
    const scopedScheduled = bindable<TCNSExplorerScheduled | null>(null);
    const now = bindable(Date.now());
    const loading = bindable(false);
    const total = bindable(0);
    const nextCursor = bindable<string | null>(null);
    const hasMore = bindable(false);

    // Whether the user scrolled past page 1 — live-tail then refreshes only facets
    // so an appended list isn't yanked back to the top under them.
    let expanded = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // Guards stale responses when the query changes mid-flight.
    let epoch = 0;

    const refetchList = async (): Promise<void> => {
        const mine = ++epoch;
        const q = query.getValue();
        loading.setValue(true);
        try {
            const [list, fac] = await Promise.all([
                client.list(q, undefined, limit),
                client.facets(q),
            ]);
            if (mine !== epoch) return; // superseded
            expanded = false;
            rows.setValue(list.stimulations);
            nextCursor.setValue(list.nextCursor);
            hasMore.setValue(Boolean(list.nextCursor));
            total.setValue(list.total ?? list.stimulations.length);
            facets.setValue(fac);
        } finally {
            if (mine === epoch) loading.setValue(false);
        }
    };

    // Lightweight topology feed (once per scope) — powers the Neurons/Collaterals
    // lists + the node-link detail diagrams. Guarded so mock clients (unit tests)
    // that don't implement it are a no-op.
    const loadTopology = async (): Promise<void> => {
        if (typeof client.topology !== 'function') return;
        try {
            topology.setValue(await client.topology(query.getValue().scopeName));
        } catch {
            /* topology is best-effort; the lists degrade gracefully */
        }
    };
    // Bounded run snapshot (flat buckets) — the Tasks list + per-neuron/collateral
    // error & fire aggregates derive from these tasks. Refreshed with the roster.
    const snapshotCache = new CNSSnapshotCache();
    const loadSnapshot = async (): Promise<void> => {
        if (typeof client.snapshot !== 'function') return;
        const mine = epoch;
        // Ask for the details of what has actually moved. The cache keeps the
        // rest, which under `'full'` volume is nearly the entire payload.
        const skip = snapshotCache.skipDetailFor();
        try {
            const snap = await client.snapshot(
                query.getValue(),
                undefined,
                skip
            );
            if (mine === epoch) snapshot.setValue(snapshotCache.merge(snap, skip));
        } catch {
            /* snapshot is best-effort */
        }
    };

    const scheduledFilterOf = (q: TCNSExplorerQuery): { neuronName?: string; collateralName?: string } | undefined =>
        q.selectedNeuron ? { neuronName: q.selectedNeuron } : q.selectedCollateral ? { collateralName: q.selectedCollateral } : undefined;
    const readsScheduled = (): boolean => typeof client.scheduled === 'function';
    const scheduledPager = new CNSScheduledPager(scheduled, cursor => client.scheduled({}, cursor, limit));
    const scopedPager = new CNSScheduledPager(scopedScheduled, cursor =>
        client.scheduled(scheduledFilterOf(query.getValue()) ?? {}, cursor, limit)
    );
    const loadScheduled = async (): Promise<void> => {
        if (readsScheduled() && query.getValue().tab === 'scheduled') await scheduledPager.refresh();
    };
    const loadMoreScheduled = async (): Promise<void> => {
        if (readsScheduled()) await scheduledPager.more();
    };
    const loadMoreScopedScheduled = async (): Promise<void> => {
        if (readsScheduled()) await scopedPager.more();
    };
    const loadScopedScheduled = async (): Promise<void> => {
        if (readsScheduled() && scheduledFilterOf(query.getValue())) await scopedPager.refresh();
    };

    // While TRUE (during a URL→state sync) we must NOT write back to the URL, or a
    // back/forward navigation would push a fresh history entry and corrupt history.
    let suppressUrlWrite = false;
    const writeUrl = (q: TCNSExplorerQuery): void => {
        if (!suppressUrlWrite) opts.writeSearch?.(encodeQuery(q));
    };

    const setQuery = (patch: Partial<TCNSExplorerQuery>): void => {
        const q = withPatch(query.getValue(), patch);
        query.setValue(q);
        writeUrl(q);
        // A different filter is a different page, so nothing held describes it
        // any more — and keeping it would let the next poll skip details for a
        // run the new page has never shown.
        snapshotCache.reset();
        scheduledPager.reset();
        void refetchList();
        void loadSnapshot();
        void loadScheduled();
    };

    const loadMore = async (): Promise<void> => {
        const cursor = nextCursor.getValue();
        if (!cursor) return;
        const mine = epoch;
        const list = await client.list(query.getValue(), cursor, limit);
        if (mine !== epoch) return;
        expanded = true;
        rows.setValue([...rows.getValue(), ...list.stimulations]);
        nextCursor.setValue(list.nextCursor);
        hasMore.setValue(Boolean(list.nextCursor));
    };

    // ── DETAILS selection + breadcrumb navigation ─────────────────────────────
    // Selection does NOT change the filtered set, so it must NOT refetch the list /
    // facets (that would be wasteful at scale and could yank the roster) — it only
    // patches the query (for the URL) and, for a stimulation, fetches its detail.
    const navStack = bindable<TCNSNavEntry[]>([]);
    const CLEAR_SEL = {
        selected: undefined,
        selectedNeuron: undefined,
        selectedCollateral: undefined,
        selectedTask: undefined,
    };
    const setSelection = (patch: Partial<TCNSExplorerQuery>): void => {
        const q = withPatch(query.getValue(), patch);
        query.setValue(q);
        writeUrl(q);
    };
    // Serialize the current trail so every selection patch also persists the
    // breadcrumb to the URL (top = last). Read at apply-time from navStack, which
    // openEntity/navBack/navTo set BEFORE calling applySelection.
    const curTrail = (): string[] =>
        navStack.getValue().map(e => `${e.kind}:${e.id}`);
    const applySelection = (entry: TCNSNavEntry): void => {
        const navTrail = curTrail();
        // A neuron scope is only meaningful while a neuron is open.
        if (entry.kind !== 'neuron') neuronScope.setValue(null);
        scopedPager.reset();
        scopedScheduled.setValue(null);
        switch (entry.kind) {
            case 'stimulation':
                setSelection({ ...CLEAR_SEL, selected: entry.id, navTrail });
                detail.setValue(null);
                void client.detail(entry.id).then(d => {
                    if (query.getValue().selected === entry.id) detail.setValue(d);
                });
                break;
            case 'neuron': {
                setSelection({ ...CLEAR_SEL, selectedNeuron: entry.id, navTrail });
                void loadScopedScheduled();
                // Full recent activation history: a snapshot filtered by THIS neuron
                // (far more than the neuron's slice of the bounded global snapshot).
                neuronScope.setValue(null);
                if (typeof client.snapshot === 'function') {
                    const q = query.getValue();
                    void client
                        .snapshot(
                            {
                                tab: 'stimulations',
                                neuronName: entry.id,
                                scopeName: q.scopeName,
                                since: q.since,
                                until: q.until,
                            },
                            500
                        )
                        .then(s => {
                            if (query.getValue().selectedNeuron === entry.id)
                                neuronScope.setValue(s);
                        })
                        .catch(() => {
                            /* scope is best-effort; detail falls back to global */
                        });
                }
                break;
            }
            case 'collateral':
                setSelection({ ...CLEAR_SEL, selectedCollateral: entry.id, navTrail });
                void loadScopedScheduled();
                break;
            case 'task':
                setSelection({ ...CLEAR_SEL, selectedTask: entry.id, navTrail });
                break;
        }
    };
    const openEntity = (entry: TCNSNavEntry, fresh = false): void => {
        const cur = navStack.getValue();
        // A fresh open (list-row click) resets the trail; a cross-link pushes.
        const stack = fresh ? [entry] : [...cur, entry];
        navStack.setValue(stack);
        applySelection(entry);
    };
    const navBack = (): void => {
        const s = navStack.getValue();
        if (s.length <= 1) {
            navStack.setValue([]);
            setSelection({ ...CLEAR_SEL, navTrail: undefined });
            detail.setValue(null);
            neuronScope.setValue(null);
            scopedPager.reset();
            scopedScheduled.setValue(null);
            return;
        }
        const ns = s.slice(0, -1);
        navStack.setValue(ns);
        applySelection(ns[ns.length - 1]);
    };
    const navTo = (index: number): void => {
        const s = navStack.getValue();
        if (index < 0 || index >= s.length) return;
        const ns = s.slice(0, index + 1);
        navStack.setValue(ns);
        applySelection(ns[ns.length - 1]);
    };
    const clearNav = (): void => {
        navStack.setValue([]);
        setSelection({ ...CLEAR_SEL, navTrail: undefined });
        detail.setValue(null);
        neuronScope.setValue(null);
        scopedPager.reset();
        scopedScheduled.setValue(null);
    };
    const selectRun = async (stimulationId: string): Promise<void> => {
        openEntity(
            { kind: 'stimulation', id: stimulationId, label: stimulationId },
            true
        );
    };

    const applyDefaultWindow = (windowMs: number | undefined): void => {
        if (!windowMs) return;
        const current = query.getValue();
        if (current.since != null || current.until != null) return;
        setQuery({ ...current, since: Date.now() - windowMs });
    };

    const allowedActions = bindable<{ retry?: boolean; clone?: boolean }>(
        opts.allowedActions ?? {}
    );
    const actionPending = bindable<string | null>(null);
    const actionError = bindable<string | null>(null);
    const actionNotice = bindable<string | null>(null);
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    // Surface a transient success toast that auto-dismisses, so an action always
    // gives visible acknowledgement (not just the error path).
    const notify = (msg: string): void => {
        actionNotice.setValue(msg);
        if (noticeTimer) clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => actionNotice.setValue(null), 6000);
    };
    const clearAction = (): void => {
        actionError.setValue(null);
        actionNotice.setValue(null);
        if (noticeTimer) clearTimeout(noticeTimer);
    };

    const retryRun = async (stimulationId: string): Promise<void> => {
        // Ignore a click while one is already in flight — a second command
        // carries the same attempt id and, without a queue behind the runtime,
        // runs the frontier twice.
        if (actionPending.getValue()) return;
        // The button is not drawn when the server disallows it; this is for
        // anything that reaches the controller another way.
        if (allowedActions.getValue().retry === false) return;
        clearAction();
        actionPending.setValue('retry');
        try {
            await client.retry(stimulationId);
            notify('Retry accepted — resuming this run');
            await refetchList();
            if (query.getValue().selected === stimulationId) {
                const d = await client.detail(stimulationId);
                detail.setValue(d);
            }
        } catch (e) {
            actionError.setValue((e as Error).message);
        } finally {
            actionPending.setValue(null);
        }
    };
    const cloneRun = async (stimulationId: string): Promise<void> => {
        if (actionPending.getValue()) return;
        if (allowedActions.getValue().clone === false) return;
        clearAction();
        actionPending.setValue('clone');
        try {
            const newId = await client.clone(stimulationId);
            notify(`Cloned → new run ${newId}`);
            await refetchList();
        } catch (e) {
            actionError.setValue((e as Error).message);
        } finally {
            actionPending.setValue(null);
        }
    };

    const commandScheduled = async (stimulationId: string, command: TCNSStimulationCommand): Promise<void> => {
        if (actionPending.getValue()) return;
        clearAction();
        actionPending.setValue(command.name);
        try {
            await client.command(stimulationId, command);
            notify(
                command.name === 'cancel'
                    ? `Cancelled ${stimulationId}`
                    : command.name === 'runNow'
                      ? `${stimulationId} moved to now`
                      : `${stimulationId} priority ${command.priority}`
            );
            scheduledPager.reset();
            scopedPager.reset();
            await Promise.all([loadScheduled(), loadScopedScheduled()]);
        } catch (e) {
            actionError.setValue((e as Error).message);
        } finally {
            actionPending.setValue(null);
        }
    };

    const launchScheduled = async (collateralName: string, payload: unknown): Promise<void> => {
        if (actionPending.getValue()) return;
        clearAction();
        actionPending.setValue('launch');
        try {
            const newStimulationId = await client.launch({ collateralName, payload });
            notify(`Launched ${newStimulationId}`);
            scheduledPager.reset();
            scopedPager.reset();
            await Promise.all([loadScheduled(), loadScopedScheduled()]);
        } catch (e) {
            actionError.setValue((e as Error).message);
        } finally {
            actionPending.setValue(null);
        }
    };

    const liveTick = async (): Promise<void> => {
        const q = query.getValue();
        const fac = await client.facets(q);
        facets.setValue(fac);
        void loadSnapshot(); // keep the Tasks list + aggregates fresh
        now.setValue(Date.now());
        void loadScheduled();
        void loadScopedScheduled();
        // Topology arrives once the app connects (which may be after our first load) —
        // keep polling until it populates, then stop.
        if (!topology.getValue().neurons.length) void loadTopology();
        if (expanded) return; // don't disturb a scrolled list
        const list = await client.list(q, undefined, limit);
        rows.setValue(list.stimulations);
        nextCursor.setValue(list.nextCursor);
        hasMore.setValue(Boolean(list.nextCursor));
        total.setValue(list.total ?? list.stimulations.length);
    };

    // Rebuild the DETAILS panel (selection + breadcrumb) from a query — used on the
    // initial load AND whenever the URL changes underneath us (back/forward).
    const hydrateNavFromQuery = (q0: TCNSExplorerQuery): void => {
        const KINDS = ['stimulation', 'neuron', 'collateral', 'task'];
        if (q0.navTrail?.length) {
            const stack: TCNSNavEntry[] = q0.navTrail
                .map(c => {
                    const i = c.indexOf(':');
                    const kind = c.slice(0, i) as TCNSNavEntry['kind'];
                    const id = c.slice(i + 1);
                    return { kind, id, label: id };
                })
                .filter(e => KINDS.includes(e.kind) && e.id);
            if (stack.length) {
                navStack.setValue(stack);
                const top = stack[stack.length - 1];
                // A task/neuron drilled from a run resolves against that run's
                // detail — preload it so the restored deep-link renders.
                const stimCrumb = stack.find(e => e.kind === 'stimulation');
                if (stimCrumb && top.kind !== 'stimulation') {
                    void client.detail(stimCrumb.id).then(d => {
                        const q = query.getValue();
                        if (q.selectedTask || q.selectedNeuron || q.selectedCollateral)
                            detail.setValue(d);
                    });
                }
                applySelection(top);
                return;
            }
        }
        if (q0.selected) {
            void selectRun(q0.selected); // bare deep-linked run
        } else {
            // The URL carries no selection → clear the panel.
            navStack.setValue([]);
            detail.setValue(null);
        }
    };

    // URL → state reactivity: when the address changes underneath us (browser
    // back/forward, or a hand-edited hash), re-decode and apply. The equality guard
    // breaks the write→hashchange→read loop our own navigations would otherwise cause.
    const syncFromUrl = (): void => {
        if (!opts.readSearch) return;
        const incoming = decodeQuery(opts.readSearch());
        if (encodeQuery(incoming) === encodeQuery(query.getValue())) return;
        suppressUrlWrite = true;
        try {
            query.setValue(incoming);
            scheduledPager.reset();
            void refetchList();
            void loadSnapshot();
            void loadScheduled();
            hydrateNavFromQuery(incoming);
        } finally {
            suppressUrlWrite = false;
        }
    };

    const start = (): void => {
        void refetchList();
        void loadTopology();
        void loadSnapshot();
        void loadScheduled();
        // Restore the DETAILS panel from the URL (trail → deep-link → nothing).
        hydrateNavFromQuery(query.getValue());
        if (typeof window !== 'undefined')
            window.addEventListener('hashchange', syncFromUrl);
        const ms = opts.liveMs ?? 2000;
        if (ms > 0) timer = setInterval(() => void liveTick(), ms);
    };
    const stop = (): void => {
        if (timer) clearInterval(timer);
        timer = null;
        if (typeof window !== 'undefined')
            window.removeEventListener('hashchange', syncFromUrl);
    };

    return {
        query,
        rows,
        facets,
        detail,
        topology,
        snapshot,
        neuronScope,
        scheduled,
        scopedScheduled,
        loadMoreScheduled,
        loadMoreScopedScheduled,
        commandScheduled,
        launchScheduled,
        now,
        loading,
        total,
        hasMore,
        setQuery,
        loadMore,
        selectRun,
        navStack,
        openEntity,
        navBack,
        navTo,
        clearNav,
        applyDefaultWindow,
        allowedActions,
        actionPending,
        retryRun,
        cloneRun,
        actionError,
        actionNotice,
        start,
        stop,
    };
}
