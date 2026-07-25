import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoBindable } from '@exodra/reactivity';

// One list primitive for every page. It maps an ordered source of items to
// identity-stable child schemas (cached by key) and drives them through a
// `bindable<schema[]>` — so the renderer reconciles by identity: a field edit is
// a structural no-op (same keys → same schema refs → focus kept), and a real
// add/move/remove only touches the diff. `render` may return `{ schema, dispose }`
// for rows that own a subscription (disposed when the row leaves the list).
//
// It also folds in the mount/unmount subscription dance: pass `subscribe` and the
// page just wires `mount`/`unmount` into its root — no hand-rolled unsub arrays.

type Rendered = TExoSchema | { schema: TExoSchema; dispose?: () => void };

export interface TExoKeyedList {
    readonly children: TExoBindable<readonly TExoSchema[], unknown>;
    /** Recompute; a no-op unless the ordered set of keys actually changed. */
    refresh(): void;
    /** Number of live (rendered) items. */
    size(): number;
    /** Subscribe (if `subscribe` was given) — wire into the page root's onExoMount. */
    mount(): void;
    /** Unsubscribe + dispose every cached row — wire into onExoUnmount. */
    unmount(): void;
}

function isWrapped(r: Rendered): r is { schema: TExoSchema; dispose?: () => void } {
    return typeof r === 'object' && r !== null && 'schema' in r;
}

export function keyedList<TItem>(opts: {
    items: () => readonly TItem[];
    key: (item: TItem) => string;
    render: (item: TItem) => Rendered;
    subscribe?: (refresh: () => void) => ReadonlyArray<() => void>;
}): TExoKeyedList {
    const cache = new Map<string, { schema: TExoSchema; dispose?: () => void }>();
    const children = bindable<readonly TExoSchema[]>([]);
    let prevKeys: readonly string[] = [];
    let subs: ReadonlyArray<() => void> = [];

    const refresh = (): void => {
        const items = opts.items();
        const keys = new Array<string>(items.length);
        for (let i = 0; i < items.length; i++) keys[i] = opts.key(items[i]);
        // Structural no-op check by element-wise compare — no per-refresh string
        // allocation, and correct even if a key contains the old delimiter.
        if (keys.length === prevKeys.length) {
            let same = true;
            for (let i = 0; i < keys.length; i++) {
                if (keys[i] !== prevKeys[i]) { same = false; break; }
            }
            if (same) return; // same ordered key set → focus preserved, no churn
        }
        prevKeys = keys;
        const live = new Set(keys);
        for (const [k, entry] of cache) {
            if (!live.has(k)) {
                entry.dispose?.();
                cache.delete(k);
            }
        }
        const schemas = new Array<TExoSchema>(items.length);
        for (let i = 0; i < items.length; i++) {
            const k = keys[i];
            let entry = cache.get(k);
            if (!entry) {
                const r = opts.render(items[i]);
                entry = isWrapped(r) ? r : { schema: r };
                cache.set(k, entry);
            }
            schemas[i] = entry.schema;
        }
        children.setValue(schemas);
    };
    refresh();

    return {
        children,
        refresh,
        size: () => cache.size,
        mount: () => {
            if (opts.subscribe) subs = opts.subscribe(refresh);
        },
        unmount: () => {
            for (const u of subs) u();
            subs = [];
            for (const [, entry] of cache) entry.dispose?.();
            cache.clear();
            prevKeys = [];
        },
    };
}
