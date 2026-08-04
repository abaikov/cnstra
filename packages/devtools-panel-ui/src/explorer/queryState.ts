// The explorer's single source of navigation truth: one query-state that the facet
// rail, roster, waterfall and charts all project from. It round-trips to the URL
// query string, so every slice is shareable / back-forward-able (the v1 "persist").
// Pure + framework-free so it unit-tests without a browser.

export type TCNSExplorerView = 'runs' | 'waterfall' | 'chart' | 'map';
export type TCNSExplorerLens = 'collaterals' | 'neurons';

export interface TCNSExplorerQuery {
    /** cns scope (a graph within an app). */
    scopeName?: string;
    /** Facet filters. */
    status?: string;
    entryCollateralName?: string;
    /** Runs that activated this neuron. */
    neuronName?: string;
    /** Free-text (stimulationId substring; server may extend to payload). */
    text?: string;
    since?: number;
    until?: number;
    /** What the result pane shows. */
    view: TCNSExplorerView;
    /** Facet-rail lens. */
    lens: TCNSExplorerLens;
    /** Selected run (drives the waterfall view). */
    selected?: string;
}

export const DEFAULT_QUERY: TCNSExplorerQuery = {
    view: 'runs',
    lens: 'collaterals',
};

const VIEWS: readonly TCNSExplorerView[] = ['runs', 'waterfall', 'chart', 'map'];
const LENSES: readonly TCNSExplorerLens[] = ['collaterals', 'neurons'];

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
    if (q.view !== DEFAULT_QUERY.view) p.set('view', q.view);
    if (q.lens !== DEFAULT_QUERY.lens) p.set('lens', q.lens);
    if (q.selected) p.set('sel', q.selected);
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
    const view = p.get('view') as TCNSExplorerView | null;
    const lens = p.get('lens') as TCNSExplorerLens | null;
    return {
        scopeName: p.get('scope') ?? undefined,
        status: p.get('status') ?? undefined,
        entryCollateralName: p.get('col') ?? undefined,
        neuronName: p.get('neuron') ?? undefined,
        text: p.get('q') ?? undefined,
        since: num('since'),
        until: num('until'),
        view: view && VIEWS.includes(view) ? view : DEFAULT_QUERY.view,
        lens: lens && LENSES.includes(lens) ? lens : DEFAULT_QUERY.lens,
        selected: p.get('sel') ?? undefined,
    };
}

/** Immutable patch helper — the UI dispatches small deltas. */
export function withPatch(
    q: TCNSExplorerQuery,
    patch: Partial<TCNSExplorerQuery>
): TCNSExplorerQuery {
    return { ...q, ...patch };
}

/** Toggle a facet filter value (click a facet chip on → sets it, click again → clears). */
export function toggleFilter(
    q: TCNSExplorerQuery,
    key: 'status' | 'entryCollateralName' | 'neuronName',
    value: string
): TCNSExplorerQuery {
    return withPatch(q, {
        [key]: q[key] === value ? undefined : value,
        // changing a filter invalidates the current selection's context, not the run
        // itself — keep `selected` so a shared deep link still opens the waterfall.
    });
}
