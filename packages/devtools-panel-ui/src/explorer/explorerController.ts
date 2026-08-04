import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import type {
    CNSExplorerWsClient,
    TCNSExplorerDetail,
} from './explorerClient';
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

// The explorer's data-layer: owns the query-state (⇄ URL) and everything projected
// from it (roster rows, facet counts, selected-run detail). The UI (slice 3) only
// reads these bindables and dispatches patches — no fetching in the view.

export interface TCNSExplorerControllerOptions {
    /** Read/write the URL query string (so the query round-trips + is shareable). */
    readSearch?: () => string;
    writeSearch?: (search: string) => void;
    /** Live-tail interval for page-1 + facets (0 disables). */
    liveMs?: number;
    /** Page size. */
    limit?: number;
}

export interface TCNSExplorerController {
    query: TExoWritableBindable<TCNSExplorerQuery, TCNSExplorerQuery>;
    rows: TExoWritableBindable<TCNSStimulationRowDTO[], TCNSStimulationRowDTO[]>;
    facets: TExoWritableBindable<TCNSStimulationFacetsDTO, TCNSStimulationFacetsDTO>;
    detail: TExoWritableBindable<TCNSExplorerDetail | null, TCNSExplorerDetail | null>;
    loading: TExoWritableBindable<boolean, boolean>;
    total: TExoWritableBindable<number, number>;
    hasMore: TExoWritableBindable<boolean, boolean>;
    /** Patch the query (updates URL, refetches list+facets, resets the page). */
    setQuery: (patch: Partial<TCNSExplorerQuery>) => void;
    /** Append the next page (infinite scroll). */
    loadMore: () => Promise<void>;
    /** Select a run → fetch its attempts/tasks and switch to the waterfall. */
    selectRun: (stimulationId: string) => Promise<void>;
    /** Resume a run's frontier (retry) — then refresh the roster + detail. */
    retryRun: (stimulationId: string) => Promise<void>;
    /** Clone a run from its entry — then refresh the roster. */
    cloneRun: (stimulationId: string) => Promise<void>;
    /** Last retry/clone error message (cleared on the next action), for the UI. */
    actionError: TExoWritableBindable<string | null, string | null>;
    start: () => void;
    stop: () => void;
}

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

    const setQuery = (patch: Partial<TCNSExplorerQuery>): void => {
        const q = withPatch(query.getValue(), patch);
        query.setValue(q);
        opts.writeSearch?.(encodeQuery(q));
        void refetchList();
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

    const selectRun = async (stimulationId: string): Promise<void> => {
        setQuery({ selected: stimulationId, view: 'waterfall' });
        detail.setValue(null);
        const d = await client.detail(stimulationId);
        if (query.getValue().selected === stimulationId) detail.setValue(d);
    };

    const actionError = bindable<string | null>(null);
    const retryRun = async (stimulationId: string): Promise<void> => {
        actionError.setValue(null);
        try {
            await client.retry(stimulationId);
            await refetchList();
            if (query.getValue().selected === stimulationId) {
                const d = await client.detail(stimulationId);
                detail.setValue(d);
            }
        } catch (e) {
            actionError.setValue((e as Error).message);
        }
    };
    const cloneRun = async (stimulationId: string): Promise<void> => {
        actionError.setValue(null);
        try {
            await client.clone(stimulationId);
            await refetchList();
        } catch (e) {
            actionError.setValue((e as Error).message);
        }
    };

    const liveTick = async (): Promise<void> => {
        const q = query.getValue();
        const fac = await client.facets(q);
        facets.setValue(fac);
        if (expanded) return; // don't disturb a scrolled list
        const list = await client.list(q, undefined, limit);
        rows.setValue(list.stimulations);
        nextCursor.setValue(list.nextCursor);
        hasMore.setValue(Boolean(list.nextCursor));
        total.setValue(list.total ?? list.stimulations.length);
    };

    const start = (): void => {
        void refetchList();
        const sel = query.getValue().selected;
        if (sel) void selectRun(sel); // restore a deep-linked waterfall
        const ms = opts.liveMs ?? 2000;
        if (ms > 0) timer = setInterval(() => void liveTick(), ms);
    };
    const stop = (): void => {
        if (timer) clearInterval(timer);
        timer = null;
    };

    return {
        query,
        rows,
        facets,
        detail,
        loading,
        total,
        hasMore,
        setQuery,
        loadMore,
        selectRun,
        retryRun,
        cloneRun,
        actionError,
        start,
        stop,
    };
}
