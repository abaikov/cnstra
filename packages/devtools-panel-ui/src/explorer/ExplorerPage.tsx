import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import { exoCombine } from '@oimdb/exodra';
import type { TCNSExplorerController } from './explorerController';
import type { TCNSExplorerTab } from './queryState';
import type { ConnectionStatus } from '../app/controllers/socket';
import { vitalsMonitor } from './VitalsMonitor';
import { viewList, detailsPane, breadcrumb } from './entityViews';
import {
    C,
    eyebrow,
    proportionBar,
    type TCNSProportionSegment,
} from './parts';

// The DevTools panel — a 4-zone dashboard. A full-width STATS strip; a top band of
// FILTERS (tabs + status/collateral/neuron/text/time) and GRAPHS (throughput chart
// + signal pulse); and a split main body of the VIEW list beside the DETAILS
// scope-card. Filters are a global scope over everything (chart + list + details);
// selecting a row fills the details panel in place — no full-screen navigation.

/** Connection identity + health, folded into the top bar. */
export type TCNSExplorerConnection = {
    connectionStatus: TExoWritableBindable<ConnectionStatus, ConnectionStatus>;
    /** Which transport carries this connection — shown beside the status dot. */
    transport?: TExoWritableBindable<'socket' | 'polling', 'socket' | 'polling'>;
    appName: TExoWritableBindable<string, string>;
};

const CLEAR_SEL = {
    selected: undefined,
    selectedNeuron: undefined,
    selectedCollateral: undefined,
    selectedTask: undefined,
};

const TABS: { id: TCNSExplorerTab; label: string }[] = [
    { id: 'stimulations', label: 'Stimulations' },
    { id: 'neurons', label: 'Neurons' },
    { id: 'tasks', label: 'Activation tasks' },
    { id: 'collaterals', label: 'Collaterals' },
    { id: 'scheduled', label: 'Scheduled' },
];

export function explorerPage(
    ctrl: TCNSExplorerController,
    conn: TCNSExplorerConnection
): TExoSchema {
    // ── identity + health ──
    const dotColor = (s: ConnectionStatus): string =>
        s === 'connected' ? C.green : s === 'connecting' ? C.yellow : C.red;
    const connBlock = exoCombine(() => {
        const s = conn.connectionStatus.getValue();
        const name = conn.appName.getValue();
        // Say which transport when it is NOT the default socket: on polling the
        // panel can be a poll behind, and "connected" alone would not explain it.
        const via =
            conn.transport?.getValue() === 'polling' ? ' · polling' : '';
        const label =
            s === 'connected'
                ? `${name || 'Server Connected'}${via}`
                : s === 'connecting'
                  ? `Connecting…${via}`
                  : `Disconnected${via}`;
        return (
            <div static={{ style: 'display:flex;align-items:center;gap:8px;flex:none' }}>
                <span static={{ class: 'brand', style: `font-size:13px;color:${C.text};white-space:nowrap` }}>🧠 CNStra</span>
                <span static={{ style: `width:8px;height:8px;border-radius:50%;flex:none;background:${dotColor(s)};box-shadow:0 0 6px ${dotColor(s)}` }} />
                <span static={{ style: `font-size:10px;color:${C.muted};white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis` }}>{label}</span>
            </div>
        );
    }, [conn.connectionStatus, conn.appName]);

    // ── stats — a COMPACT VERTICAL column that sits beside the chart (saves the
    // full-width row the pill-cards used to eat). One `label … number` line each,
    // tabular-nums so a live tick never shifts anything. ──
    const statMini = (value: number, label: string, color: string): TExoSchema => (
        <div static={{ style: 'display:flex;align-items:baseline;justify-content:space-between;gap:10px' }}>
            <span static={{ style: `font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};white-space:nowrap` }}>{label}</span>
            <span static={{ style: `font-size:16px;font-weight:700;line-height:1;color:${color};font-family:var(--font-body);font-variant-numeric:tabular-nums` }}>{String(value)}</span>
        </div>
    );
    const statsColumn = exoCombine(() => {
        const f = ctrl.facets.getValue();
        const countOf = (s: string): number =>
            f.byStatus.find(x => x.status === s)?.count ?? 0;
        const topo = ctrl.topology.getValue();
        const snap = ctrl.snapshot.getValue();
        return (
            <div static={{ style: `flex:none;width:150px;display:flex;flex-direction:column;gap:7px;padding:8px 10px;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-secondary)` }}>
                {statMini(ctrl.total.getValue(), 'stimulations', C.violet)}
                {statMini(countOf('completed'), 'completed', C.green)}
                {statMini(countOf('failed'), 'failed', C.red)}
                {statMini(countOf('running'), 'running', C.yellow)}
                <div static={{ style: 'height:1px;background:var(--border-primary);margin:1px 0' }} />
                {statMini(topo.neurons.length, 'neurons', C.cyan)}
                {statMini(topo.collaterals.length, 'collaterals', C.pink)}
                {statMini(snap.tasks.length, 'tasks loaded', C.green)}
            </div>
        );
    }, [ctrl.total, ctrl.facets, ctrl.topology, ctrl.snapshot]);

    // ── status distribution (proportion bar) ──
    const distribution = exoCombine(() => {
        const f = ctrl.facets.getValue();
        const countOf = (s: string): number =>
            f.byStatus.find(x => x.status === s)?.count ?? 0;
        const segs: TCNSProportionSegment[] = [
            { label: 'completed', value: countOf('completed'), color: C.green },
            { label: 'failed', value: countOf('failed'), color: C.red },
            { label: 'running', value: countOf('running'), color: C.yellow },
        ];
        return proportionBar(segs);
    }, [ctrl.facets]);

    // ── tabs ──
    const setTab = (tab: TCNSExplorerTab): void => {
        ctrl.setQuery({ tab, ...CLEAR_SEL });
        ctrl.clearNav(); // switching tabs resets the details breadcrumb trail
    };
    const tabs = exoCombine(() => {
        const active = ctrl.query.getValue().tab;
        return (
            <div static={{ style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:4px' }}>
                {TABS.map(t => {
                    const on = active === t.id;
                    return (
                        <button
                            static={{
                                class: 'exp-tab' + (on ? ' active' : ''),
                                style:
                                    `padding:5px 12px;font-size:11px;cursor:pointer;text-transform:uppercase;letter-spacing:1px;border-radius:4px;` +
                                    (on
                                        ? `background:${C.pink};color:var(--bg-primary);border:1px solid ${C.pink};font-weight:700`
                                        : `background:var(--bg-card);color:${C.sub};border:1px solid var(--border-primary)`),
                            }}
                            handlers={{ onClick: () => setTab(t.id) }}
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>
        );
    }, [ctrl.query]);

    // ── status filter pills ──
    const statusPillBtn = (
        val: string | undefined,
        text: string,
        count: number,
        active: boolean,
        color: string
    ): TExoSchema => (
        <button
            static={{
                style:
                    `display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:10px;` +
                    `text-transform:uppercase;letter-spacing:.5px;cursor:pointer;white-space:nowrap;` +
                    `border:1px solid ${active ? color : 'var(--border-primary)'};` +
                    (active
                        ? `background:${color}22;color:${color}`
                        : `background:var(--bg-card);color:${C.muted}`),
            }}
            handlers={{ onClick: () => ctrl.setQuery({ status: val }) }}
        >
            <span static={{ style: `width:6px;height:6px;border-radius:50%;flex:none;background:${color}` }} />
            <span>{text}</span>
            {/* fixed-width count so a live tick never reflows the pill row */}
            <span static={{ style: 'font-variant-numeric:tabular-nums;min-width:42px;text-align:right' }}>{String(count)}</span>
        </button>
    );
    const statusFilter = exoCombine(() => {
        const f = ctrl.facets.getValue();
        const q = ctrl.query.getValue();
        const countOf = (s: string): number =>
            f.byStatus.find(x => x.status === s)?.count ?? 0;
        const total = f.byStatus.reduce((n, x) => n + x.count, 0);
        return (
            <div static={{ style: 'display:flex;gap:5px;flex-wrap:wrap' }}>
                {[
                    statusPillBtn(undefined, 'All', total, !q.status, C.pink),
                    statusPillBtn('completed', 'Completed', countOf('completed'), q.status === 'completed', C.green),
                    statusPillBtn('failed', 'Failed', countOf('failed'), q.status === 'failed', C.red),
                    statusPillBtn('running', 'Running', countOf('running'), q.status === 'running', C.yellow),
                ]}
            </div>
        );
    }, [ctrl.facets, ctrl.query]);

    // ── secondary filters: entry-only toggle · neuron select · search · time range ──
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const searchBox: TExoSchema = (
        <input
            static={{
                placeholder: 'search stimulationId…',
                style:
                    'flex:1;min-width:140px;padding:5px 8px;font-size:11px;background:var(--bg-secondary);' +
                    'border:1px solid var(--border-primary);color:var(--text-primary);border-radius:4px',
            }}
            handlers={{
                onInput: (e: Event) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (debounce) clearTimeout(debounce);
                    debounce = setTimeout(
                        () => ctrl.setQuery({ text: v || undefined }),
                        300
                    );
                },
            }}
        />
    );
    const entryToggle = exoCombine(() => {
        const on = !!ctrl.query.getValue().entryOnly;
        // Active filter selection reads PINK (consistent selection colour).
        return (
            <button
                static={{
                    title: 'Show only entry collaterals (owner-less)',
                    style:
                        `display:inline-flex;align-items:center;gap:6px;padding:5px 10px;font-size:10px;border-radius:4px;cursor:pointer;` +
                        `text-transform:uppercase;letter-spacing:.5px;border:1px solid ${on ? C.pink : 'var(--border-primary)'};` +
                        (on ? `background:${C.pink}22;color:${C.pink}` : `background:var(--bg-card);color:${C.muted}`),
                }}
                handlers={{ onClick: () => ctrl.setQuery({ entryOnly: on ? undefined : true }) }}
            >
                <span static={{ style: `width:8px;height:8px;border-radius:2px;border:1px solid ${on ? C.pink : C.muted};background:${on ? C.pink : 'transparent'}` }} />
                entry collaterals only
            </button>
        );
    }, [ctrl.query]);
    // Typeahead filter — scales to HUNDREDS of names (a <select> would not). The
    // input element is STABLE (created once per open/chip toggle) so typing never
    // yanks focus; only the suggestion dropdown re-renders per keystroke.
    const makeTypeahead = (cfg: {
        placeholder: string;
        accent: string;
        source: TExoWritableBindable<unknown, unknown>;
        getNames: () => string[];
        getCurrent: () => string | undefined;
        onPick: (name: string) => void;
        onClear: () => void;
    }): TExoSchema => {
        const text = bindable('');
        const open = bindable(false);
        const dropdown = exoCombine(() => {
            if (!open.getValue()) return <div static={{ style: 'display:none' }} />;
            const q = text.getValue().trim().toLowerCase();
            const all = cfg.getNames();
            const matches = (q ? all.filter(n => n.toLowerCase().includes(q)) : all);
            const shown = matches.slice(0, 12);
            if (!shown.length)
                return (
                    <div static={{ style: `position:absolute;top:100%;left:0;right:0;z-index:20;margin-top:2px;padding:6px 8px;font-size:10px;color:${C.muted};background:var(--bg-card);border:1px solid var(--border-primary);border-radius:4px` }}>
                        no matches
                    </div>
                );
            return (
                <div static={{ style: 'position:absolute;top:100%;left:0;right:0;z-index:20;margin-top:2px;max-height:220px;overflow:auto;background:var(--bg-card);border:1px solid var(--border-accent);border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.5)' }}>
                    <div static={{ style: `padding:3px 8px;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};border-bottom:1px solid var(--border-primary)` }}>
                        {matches.length} match{matches.length === 1 ? '' : 'es'}
                    </div>
                    {shown.map(n => (
                        <div
                            static={{
                                class: 'exp-ta-item',
                                style: `padding:5px 8px;font-size:11px;color:${C.sub};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
                            }}
                            handlers={{
                                onMouseDown: () => {
                                    cfg.onPick(n);
                                    text.setValue('');
                                    open.setValue(false);
                                },
                            }}
                        >
                            {n}
                        </div>
                    ))}
                </div>
            );
        }, [text, open, cfg.source]);
        const inputBlock = (
            <div static={{ style: 'position:relative;flex:1;min-width:150px' }}>
                <input
                    static={{
                        placeholder: cfg.placeholder,
                        style:
                            `width:100%;box-sizing:border-box;padding:5px 8px;font-size:11px;background:var(--bg-secondary);` +
                            `border:1px solid var(--border-primary);color:var(--text-primary);border-radius:4px`,
                    }}
                    handlers={{
                        onInput: (e: Event) => {
                            text.setValue((e.target as HTMLInputElement).value);
                            open.setValue(true);
                        },
                        onFocus: () => open.setValue(true),
                        onBlur: () => setTimeout(() => open.setValue(false), 150),
                    }}
                />
                <div bindable={{ children: dropdown }} />
            </div>
        );
        // The input ALWAYS stays an input — the active filter's removable tag lives
        // in the filter-chips row below, so there is no second chip up here.
        return <div static={{ style: 'flex:1;min-width:150px' }}>{inputBlock}</div>;
    };
    const neuronTypeahead = makeTypeahead({
        placeholder: 'filter by neuron…',
        accent: C.violet,
        source: ctrl.topology as TExoWritableBindable<unknown, unknown>,
        getNames: () =>
            [...new Set(ctrl.topology.getValue().neurons.map(n => n.name))].sort(),
        getCurrent: () => ctrl.query.getValue().neuronName,
        onPick: (n: string) => ctrl.setQuery({ neuronName: n }),
        onClear: () => ctrl.setQuery({ neuronName: undefined }),
    });
    const collateralTypeahead = makeTypeahead({
        placeholder: 'filter by collateral…',
        accent: C.cyan,
        source: ctrl.topology as TExoWritableBindable<unknown, unknown>,
        getNames: () =>
            [...new Set(ctrl.topology.getValue().collaterals.map(c => c.name))].sort(),
        getCurrent: () => ctrl.query.getValue().entryCollateralName,
        // Filtering by a collateral → switch the VIEW to the Collaterals tab.
        onPick: (n: string) => ctrl.setQuery({ entryCollateralName: n, tab: 'collaterals' }),
        onClear: () => ctrl.setQuery({ entryCollateralName: undefined }),
    });
    // Which SINGLE preset (in ms; 0 = "All") the current query represents. A relative
    // preset stores `since = now − ms`, so "5m" also falls inside "last 15m/1h/24h" —
    // deriving with `<=` lit them all. Instead pick the NEAREST preset window and only
    // if the elapsed offset is close to it (else it's a custom `since`, nothing lit).
    const PRESET_MS = [5 * 60000, 15 * 60000, 60 * 60000, 24 * 60 * 60000];
    const activeRangeMs = (): number | null => {
        const { since, until } = ctrl.query.getValue();
        if (since == null && until == null) return 0; // All
        if (since == null || until != null) return null; // custom range → no preset
        const elapsed = Date.now() - since;
        let best = PRESET_MS[0];
        let bestD = Infinity;
        for (const ms of PRESET_MS) {
            const d = Math.abs(elapsed - ms);
            if (d < bestD) {
                bestD = d;
                best = ms;
            }
        }
        return bestD <= best * 0.5 ? best : null;
    };
    const rangeBtn = (label: string, ms: number): TExoSchema => {
        const b = exoCombine(() => {
            const active = activeRangeMs() === ms;
            return (
                <button
                    static={{
                        style:
                            `padding:5px 12px;font-size:11px;cursor:pointer;border-radius:5px;` +
                            `border:1px solid ${active ? C.pink : 'var(--border-primary)'};` +
                            (active ? `background:${C.pink}22;color:${C.pink};font-weight:700` : `background:var(--bg-card);color:${C.muted}`),
                    }}
                    handlers={{
                        onClick: () =>
                            ctrl.setQuery({
                                since: ms === 0 ? undefined : Date.now() - ms,
                                until: undefined,
                            }),
                    }}
                >
                    {label}
                </button>
            );
        }, [ctrl.query]);
        return <div bindable={{ children: b }} />;
    };
    // A custom absolute From/To picker alongside the quick presets. `datetime-local`
    // reads/writes local wall-clock; the element is STABLE (built once in onExoMount)
    // and value-synced imperatively so spinner edits never yank focus.
    const toLocalInput = (ms?: number): string => {
        if (ms == null) return '';
        const d = new Date(ms);
        const p = (n: number): string => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const fromLocalInput = (v: string): number | undefined => {
        if (!v) return undefined;
        const t = new Date(v).getTime();
        return Number.isFinite(t) ? t : undefined;
    };
    const dtField = (label: string, key: 'since' | 'until'): TExoSchema => (
        <label static={{ style: `display:inline-flex;align-items:center;gap:5px;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${C.muted};white-space:nowrap` }}>
            {label}
            <input
                static={{
                    style:
                        `padding:4px 6px;font-size:10px;background:var(--bg-secondary);` +
                        `border:1px solid var(--border-primary);color:var(--text-primary);border-radius:4px;` +
                        `color-scheme:dark`,
                    onExoMount: (n: { element: unknown }) => {
                        const inp = n.element as HTMLInputElement;
                        inp.type = 'datetime-local';
                        const sync = (): void => {
                            const v = ctrl.query.getValue()[key];
                            const next = v != null ? toLocalInput(v as number) : '';
                            if (inp.value !== next) inp.value = next;
                        };
                        sync();
                        ctrl.query.subscribe(sync);
                        inp.addEventListener('change', () =>
                            ctrl.setQuery({ [key]: fromLocalInput(inp.value) })
                        );
                    },
                }}
            />
        </label>
    );
    const clearRange = exoCombine(() => {
        const { since, until } = ctrl.query.getValue();
        if (since == null && until == null) return <div static={{ style: 'display:none' }} />;
        return (
            <button
                static={{
                    title: 'Clear time range',
                    style: `padding:4px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;border-radius:4px;border:1px solid ${C.pink};color:${C.pink};background:${C.pink}1a`,
                }}
                handlers={{ onClick: () => ctrl.setQuery({ since: undefined, until: undefined }) }}
            >
                ✕ clear
            </button>
        );
    }, [ctrl.query]);
    // Obvious TIME RANGE block — it scopes EVERYTHING (chart + list + the stats
    // below), so the stat numbers are always "over this range".
    // Quick presets — sit inline with the "Time range" heading (space-saving).
    const timePresets: TExoSchema = (
        <div static={{ style: 'display:flex;gap:5px;align-items:center;flex-wrap:wrap' }}>
            {[
                rangeBtn('5m', 5 * 60000),
                rangeBtn('15m', 15 * 60000),
                rangeBtn('1h', 60 * 60000),
                rangeBtn('24h', 24 * 60 * 60000),
                rangeBtn('All', 0),
            ]}
        </div>
    );
    // The custom From/To picker — its own row below the heading+presets.
    const timePicker: TExoSchema = (
        <div static={{ style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }}>
            {[dtField('from', 'since'), dtField('to', 'until')]}
            <div bindable={{ children: clearRange }} />
        </div>
    );

    // ── active filter chips ──
    const chip = (label: string, onClear: () => void): TExoSchema => (
        <button
            static={{
                style:
                    `display:inline-flex;align-items:center;gap:5px;padding:2px 8px;font-size:10px;border-radius:999px;cursor:pointer;flex:none;white-space:nowrap;` +
                    `border:1px solid ${C.violet};color:${C.violet};background:${C.violet}1a`,
            }}
            handlers={{ onClick: onClear }}
        >
            {label} ✕
        </button>
    );
    const filterChips = exoCombine(() => {
        const q = ctrl.query.getValue();
        const active: TExoSchema[] = [];
        if (q.status) active.push(chip(`status: ${q.status}`, () => ctrl.setQuery({ status: undefined })));
        if (q.neuronName) active.push(chip(`neuron: ${q.neuronName}`, () => ctrl.setQuery({ neuronName: undefined })));
        if (q.entryCollateralName) active.push(chip(`collateral: ${q.entryCollateralName}`, () => ctrl.setQuery({ entryCollateralName: undefined })));
        if (q.entryOnly) active.push(chip('entry only', () => ctrl.setQuery({ entryOnly: undefined })));
        if (q.text) active.push(chip(`"${q.text}"`, () => ctrl.setQuery({ text: undefined })));
        if (q.since != null) active.push(chip('time range', () => ctrl.setQuery({ since: undefined })));
        if (!active.length) return <div static={{ style: 'display:none' }} />;
        // ONE nowrap row that scrolls horizontally — active filters never wrap and
        // so never push the rest of the layout down as you add/remove them.
        return (
            <div static={{ style: 'display:flex;gap:5px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin' }}>
                {active}
            </div>
        );
    }, [ctrl.query]);

    // ── zone frame helper ──
    // An empty label renders NO eyebrow — the filters zone uses its 🧠 CNStra
    // brand row as its own header (no redundant "FILTERS · VIEWS" band).
    const zone = (label: string, color: string, body: TExoSchema): TExoSchema => (
        <div static={{ style: `flex:none;display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-panel)` }}>
            {label ? eyebrow(label, color) : <span />}
            {body}
        </div>
    );

    // Only the filters that DO something for the ACTIVE tab are shown (time range is
    // common, below). Every control stays mounted in ONE position; the container's
    // class is toggled to `exp-filters tab-<active>` imperatively (no re-render, so
    // typing never loses focus) and pure CSS hides the irrelevant ones per tab.
    const followTab = (baseClass: string) => (n: { element: unknown }): void => {
        const el = n.element as HTMLElement;
        const sync = (): void => {
            el.className = `${baseClass} tab-${ctrl.query.getValue().tab}`;
        };
        sync();
        ctrl.query.subscribe(sync);
    };
    const tabFilters = (
        <div
            static={{
                class: 'exp-filters',
                style: 'display:flex;flex-direction:column;gap:12px',
                onExoMount: followTab('exp-filters'),
            }}
        >
            {/* status pills (their own row when shown) */}
            <div static={{ class: 'fg-toggles', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }}>
                <div static={{ class: 'fg-status', style: 'flex:none' }} bindable={{ children: statusFilter }} />
            </div>
            {/* inputs row: entry toggle (compact) + search + the two typeaheads — the
                toggle sits inline so the input beside it just shrinks, no lone row */}
            <div static={{ class: 'fg-inputs', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }}>
                <div static={{ class: 'fg-entry', style: 'flex:none' }} bindable={{ children: entryToggle }} />
                <div static={{ class: 'fg-search', style: 'flex:2 1 220px;display:flex;min-width:0' }}>{searchBox}</div>
                <div static={{ class: 'fg-neuron', style: 'flex:1 1 160px;display:flex;min-width:0' }}>{neuronTypeahead}</div>
                <div static={{ class: 'fg-collateral', style: 'flex:1 1 160px;display:flex;min-width:0' }}>{collateralTypeahead}</div>
            </div>
        </div>
    );

    // ── FILTERS zone (no eyebrow — the brand row is the header) ──
    const filtersZone = zone(
        '',
        C.yellow,
        <div static={{ style: 'display:flex;flex-direction:column;gap:12px' }}>
            {/* header: brand on the left, the VIEW tabs pushed to the right edge */}
            <div static={{ style: 'display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap' }}>
                <div static={{ style: 'flex:none' }} bindable={{ children: connBlock }} />
                <div static={{ style: 'flex:1 1 100%;min-width:0' }} bindable={{ children: tabs }} />
            </div>
            {/* only the filters relevant to the active tab */}
            {tabFilters}
            {/* time range (COMMON to every tab): heading + quick presets share one
                line; the custom picker gets the next line — saves vertical space */}
            <div static={{ class: 'exp-time', style: 'display:flex;flex-direction:column;gap:8px', onExoMount: followTab('exp-time') }}>
                <div static={{ style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' }}>
                    {eyebrow('Time range', C.pink)}
                    {timePresets}
                </div>
                {timePicker}
            </div>
            {/* active-filter tags — a RESERVED-height strip so tags appearing /
                disappearing never reflow the layout above */}
            <div static={{ class: 'exp-chips', style: 'min-height:24px;display:flex;align-items:center', onExoMount: followTab('exp-chips') }} bindable={{ children: filterChips }} />
        </div>
    );

    // ── GRAPHS zone (COLLAPSIBLE — collapse it to give the details panel the room) ──
    const graphsCollapsed = bindable(false);
    const graphsBody = (
        <div static={{ style: 'display:flex;gap:12px;align-items:stretch;flex-wrap:wrap' }}>
            {/* compact vertical stats beside the chart */}
            <div bindable={{ children: statsColumn }} />
            <div static={{ style: 'flex:1;min-width:240px;display:flex;flex-direction:column;gap:10px' }}>
                {vitalsMonitor(ctrl.facets, ctrl.total, (since, until) =>
                    ctrl.setQuery({ since, until })
                )}
                <div bindable={{ children: distribution }} />
            </div>
        </div>
    );
    const graphsToggle = exoCombine(() => {
        const off = graphsCollapsed.getValue();
        return (
            <button
                static={{
                    title: off ? 'Expand the chart' : 'Collapse the chart (more room for details)',
                    style:
                        `display:inline-flex;align-items:center;gap:5px;padding:2px 9px;font-size:9px;letter-spacing:.5px;text-transform:uppercase;` +
                        `cursor:pointer;border-radius:4px;border:1px solid var(--border-primary);background:var(--bg-card);color:${C.muted}`,
                }}
                handlers={{ onClick: () => graphsCollapsed.setValue(!off) }}
            >
                {off ? '▸ show chart' : '▾ hide chart'}
            </button>
        );
    }, [graphsCollapsed]);
    const graphsZone = (
        <div static={{ style: 'flex:none;display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-panel)' }}>
            <div static={{ style: 'display:flex;align-items:center;gap:8px' }}>
                {eyebrow('Graphs · Vitals', C.green)}
                <div static={{ style: 'flex:1' }} />
                <div bindable={{ children: graphsToggle }} />
            </div>
            <div bindable={{ children: exoCombine(() => (graphsCollapsed.getValue() ? <span static={{ style: 'display:none' }} /> : graphsBody), [graphsCollapsed]) }} />
        </div>
    );

    // ── VIEW list (NO own header — the active TAB above it in the filters is its
    // heading; the list is attached under the filters, same column width) ──
    const viewZone = (
        <div static={{ style: 'flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-panel);overflow:hidden' }}>
            <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0' }} bindable={{ children: viewList(ctrl) as never }} />
        </div>
    );
    const detailsZone = (
        <div static={{ style: 'flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-panel);overflow:hidden' }}>
            {/* breadcrumb / back navigation lives in the details header */}
            <div static={{ style: 'padding:10px 12px;border-bottom:1px solid var(--border-primary)' }} bindable={{ children: breadcrumb(ctrl) as never }} />
            <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0;overflow:auto' }} bindable={{ children: detailsPane(ctrl) as never }} />
        </div>
    );

    // Layout: TWO columns filling the viewport (never page-scrolls). LEFT = filters
    // (natural height) + the view list (fills, scrolls internally) at ONE width.
    // RIGHT = the collapsible chart + the details panel (fills, scrolls internally).
    // `min-height:0` on every flex ancestor lets the inner scrollers bound (the
    // classic flexbox gotcha). Collapsing the chart hands its height to details.
    return (
        <div
            static={{
                class: 'exp-root',
                style: 'display:flex;flex:1;gap:10px;min-height:0;height:100%;overflow:hidden;padding:10px;box-sizing:border-box;background:var(--bg-primary)',
                onExoMount: () => ctrl.start(),
                onExoUnmount: () => ctrl.stop(),
            }}
        >
            {/* LEFT column: filters + the list it drives (same width) */}
            <div static={{ style: 'flex:1 1 360px;min-width:300px;display:flex;flex-direction:column;gap:10px;min-height:0' }}>
                {filtersZone}
                {viewZone}
            </div>
            {/* RIGHT column: collapsible chart + details */}
            <div static={{ style: 'flex:1.5 1 440px;min-width:360px;display:flex;flex-direction:column;gap:10px;min-height:0' }}>
                {graphsZone}
                {detailsZone}
            </div>
        </div>
    );
}
