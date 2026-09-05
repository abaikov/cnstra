// The explorer's single source of navigation truth: one query-state that the
// FILTERS zone (tabs + status/collateral/neuron/text/time), the VIEW list and the
// DETAILS split-panel all project from. It round-trips to the URL query string so
// every slice is shareable / back-forward-able. Pure + framework-free so it
// unit-tests without a browser.

/** The active VIEW list (one of the four entity tabs). */
export type TCNSExplorerTab =
    | 'stimulations'
    | 'neurons'
    | 'tasks'
    | 'collaterals';

export interface TCNSExplorerQuery {
    /** cns scope (a graph within an app). */
    scopeName?: string;
    // ── filters (FILTERS zone) ──
    status?: string;
    entryCollateralName?: string;
    /** Runs that activated this neuron. */
    neuronName?: string;
    /** Free-text (stimulationId substring; server may extend to payload). */
    text?: string;
    since?: number;
    until?: number;
    /** Collaterals list: show only entry (owner-less) collaterals — a BOOLEAN filter. */
    entryOnly?: boolean;
    // ── active tab (which entity the VIEW list shows) ──
    tab: TCNSExplorerTab;
    // ── DETAILS split-panel selection (per entity type) ──
    /** Selected stimulation (its waterfall fills the details panel). */
    selected?: string;
    /** Selected neuron name (neuron scope-card in the details panel). */
    selectedNeuron?: string;
    /** Selected collateral name (collateral scope-card in the details panel). */
    selectedCollateral?: string;
    /** Selected activation-task key `${attemptId}:${index}`. */
    selectedTask?: string;
    /**
     * The DETAILS breadcrumb trail, serialized as `kind:id` crumbs (top = last), so
     * a reload restores the whole drill path — not just the final selection.
     */
    navTrail?: string[];
    /**
     * Dot-path into the entry payload to SUM per time-bucket in the throughput
     * chart (e.g. `pages`). Aggregation directive passed to the facets request.
     */
    metricPath?: string;
}

export const DEFAULT_QUERY: TCNSExplorerQuery = {
    tab: 'stimulations',
};

const TABS: readonly TCNSExplorerTab[] = [
    'stimulations',
    'neurons',
    'tasks',
    'collaterals',
];

/** Just the filter subset the server's `filter` field understands. */
export function toServerFilter(q: TCNSExplorerQuery): {
    status?: string;
    entryCollateralName?: string;
    neuronName?: string;
    text?: string;
    since?: number;
    until?: number;
} {
    const f: ReturnType<typeof toServerFilter> = {};
    if (q.status) f.status = q.status;
    if (q.entryCollateralName) f.entryCollateralName = q.entryCollateralName;
    if (q.neuronName) f.neuronName = q.neuronName;
    if (q.text) f.text = q.text;
    if (q.since != null) f.since = q.since;
    if (q.until != null) f.until = q.until;
    return f;
}

/** query-state → URL query string (stable key order; omits defaults). */
export function encodeQuery(q: TCNSExplorerQuery): string {
    const p = new URLSearchParams();
    if (q.scopeName) p.set('scope', q.scopeName);
    if (q.status) p.set('status', q.status);
    if (q.entryCollateralName) p.set('col', q.entryCollateralName);
    if (q.neuronName) p.set('neuron', q.neuronName);
    if (q.text) p.set('q', q.text);
    if (q.since != null) p.set('since', String(q.since));
    if (q.until != null) p.set('until', String(q.until));
    if (q.entryOnly) p.set('entry', '1');
    if (q.tab !== DEFAULT_QUERY.tab) p.set('tab', q.tab);
    if (q.selected) p.set('sel', q.selected);
    if (q.selectedNeuron) p.set('sn', q.selectedNeuron);
    if (q.selectedCollateral) p.set('sc', q.selectedCollateral);
    if (q.selectedTask) p.set('st', q.selectedTask);
    // Breadcrumb trail: crumbs joined by '~', each already `kind:id`.
    if (q.navTrail?.length) p.set('nav', q.navTrail.join('~'));
    if (q.metricPath) p.set('metric', q.metricPath);
    return p.toString();
}

/** URL query string → query-state (unknown/invalid values fall back to defaults). */
export function decodeQuery(search: string): TCNSExplorerQuery {
    const p = new URLSearchParams(
        search.startsWith('?') ? search.slice(1) : search
    );
    const num = (k: string): number | undefined => {
        const v = p.get(k);
        if (v == null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
    };
    const tab = p.get('tab') as TCNSExplorerTab | null;
    return {
        scopeName: p.get('scope') ?? undefined,
        status: p.get('status') ?? undefined,
        entryCollateralName: p.get('col') ?? undefined,
        neuronName: p.get('neuron') ?? undefined,
        text: p.get('q') ?? undefined,
        since: num('since'),
        until: num('until'),
        entryOnly: p.get('entry') === '1' ? true : undefined,
        tab: tab && TABS.includes(tab) ? tab : DEFAULT_QUERY.tab,
        selected: p.get('sel') ?? undefined,
        selectedNeuron: p.get('sn') ?? undefined,
        selectedCollateral: p.get('sc') ?? undefined,
        selectedTask: p.get('st') ?? undefined,
        navTrail: p.get('nav')?.split('~').filter(Boolean) ?? undefined,
        metricPath: p.get('metric') ?? undefined,
    };
}

/** Immutable patch helper — the UI dispatches small deltas. */
export function withPatch(
    q: TCNSExplorerQuery,
    patch: Partial<TCNSExplorerQuery>
): TCNSExplorerQuery {
    return { ...q, ...patch };
}

/** Toggle a facet filter value (click on → sets it, click again → clears). */
export function toggleFilter(
    q: TCNSExplorerQuery,
    key: 'status' | 'entryCollateralName' | 'neuronName',
    value: string
): TCNSExplorerQuery {
    return withPatch(q, {
        [key]: q[key] === value ? undefined : value,
    });
}
