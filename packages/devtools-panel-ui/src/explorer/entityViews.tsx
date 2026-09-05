import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import { fmtTime } from '../utils/format';
import type { TCNSExplorerController } from './explorerController';
import {
    buildNeuronRows,
    buildCollateralRows,
    buildTaskRows,
    neuronDetail,
    collateralDetail,
} from './aggregate';
import { nodeLinkDiagram, type TDiagramTarget } from './diagram';
import {
    C,
    eyebrow,
    statusPill,
    bigStat,
    factBullet,
    factList,
    progressBar,
    scopeCard,
} from './parts';

// The four entity VIEW lists + their DETAILS scope-cards (neuron / collateral /
// task / stimulation), rendered into the split-view. Lists elevate to clean rows
// with a left accent bar + quiet right-aligned metrics; details render the elegant
// node-link scope cards (and the stimulation as a numbered pipeline).

// ── navigation ──────────────────────────────────────────────────────────────
// A `fresh` open (list-row click) RESETS the breadcrumb trail; a cross-link click
// (inside a detail) PUSHES onto it so drilling is fully reversible via ← back.
const openNeuron = (ctrl: TCNSExplorerController, name: string, fresh = false): void =>
    ctrl.openEntity({ kind: 'neuron', id: name, label: name }, fresh);
const openCollateral = (ctrl: TCNSExplorerController, name: string, fresh = false): void =>
    ctrl.openEntity({ kind: 'collateral', id: name, label: name }, fresh);
const openTask = (ctrl: TCNSExplorerController, key: string, label: string, fresh = false): void =>
    ctrl.openEntity({ kind: 'task', id: key, label }, fresh);

// ── windowed list (fixed-height rows) ──────────────────────────────────────────
// Only the visible WINDOW of rows renders; a full-height spacer keeps the
// scrollbar honest. The scroll CONTAINER is a stable element created once — its
// window swaps via a bindable, so a 2s live refresh (or infinite-scroll append)
// never resets the native scrollTop (the classic "list snaps back to top" bug),
// and hundreds/thousands of rows stay smooth.
const ROW_H = 52;
const OVERSCAN = 8;

interface TRowOpts {
    accent: string;
    active: boolean;
    onClick: () => void;
    left: TExoSchema;
    right: TExoSchema;
}
/** One absolutely-positioned fixed-height row. Selection reads PINK. */
function rowAbs(top: number, o: TRowOpts): TExoSchema {
    return (
        <div
            static={{
                class: 'exp-row' + (o.active ? ' active' : ''),
                style:
                    `position:absolute;top:${top}px;left:0;right:0;height:${ROW_H}px;` +
                    `display:flex;align-items:center;gap:10px;padding:0 12px;cursor:pointer;` +
                    `border-bottom:1px solid var(--border-secondary);border-left:3px solid ${o.active ? C.pink : o.accent};font-size:12px`,
            }}
            handlers={{ onClick: o.onClick }}
        >
            <div static={{ style: 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px' }}>{o.left}</div>
            <div static={{ style: 'flex:none;display:flex;align-items:center;gap:12px' }}>{o.right}</div>
        </div>
    );
}

function windowedScroller<T>(
    deps: unknown[],
    getItems: () => T[],
    renderItem: (item: T, top: number) => TExoSchema,
    empty: string,
    onNearBottom?: () => void
): TExoSchema {
    const scrollTop = bindable(0);
    const viewportH = bindable(600);
    const win = combine([...(deps as never[]), scrollTop, viewportH], () => {
        const items = getItems();
        if (!items.length) return emptyState(empty);
        const st = scrollTop.getValue();
        const vh = viewportH.getValue();
        const first = Math.max(0, Math.floor(st / ROW_H) - OVERSCAN);
        const last = Math.min(items.length, Math.ceil((st + vh) / ROW_H) + OVERSCAN);
        const rows = items
            .slice(first, last)
            .map((it, i) => renderItem(it, (first + i) * ROW_H));
        return (
            <div static={{ style: `height:${items.length * ROW_H}px;position:relative;min-height:100%` }}>
                {rows}
            </div>
        );
    });
    return (
        <div
            static={{
                class: 'exp-scroll',
                style: 'flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;position:relative',
                onExoMount: (n: { element: unknown }) => {
                    const el = n.element as HTMLElement;
                    viewportH.setValue(el.clientHeight || 600);
                },
            }}
            handlers={{
                onScroll: (e: Event) => {
                    const el = e.target as HTMLElement;
                    scrollTop.setValue(el.scrollTop);
                    if (
                        onNearBottom &&
                        el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 8
                    )
                        onNearBottom();
                },
            }}
            bindable={{ children: win }}
        />
    );
}

const metric = (value: string | number, label: string, color: string): TExoSchema => (
    <div static={{ style: 'display:flex;flex-direction:column;align-items:flex-end;gap:1px' }}>
        <span static={{ style: `font-size:13px;font-weight:600;color:${color};font-family:var(--font-body);font-variant-numeric:tabular-nums` }}>{String(value)}</span>
        <span static={{ style: `font-size:8px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};white-space:nowrap` }}>{label}</span>
    </div>
);

/** Small outlined tag — a labelled chip used to name a row's owner/role inline. */
const rowTag = (text: string, color: string): TExoSchema => (
    <span
        static={{
            style:
                `flex:none;display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:9px;` +
                `letter-spacing:.5px;text-transform:uppercase;white-space:nowrap;` +
                `border:1px solid ${color}66;color:${color};background:${color}14`,
        }}
    >
        {text}
    </span>
);

const rowTitle = (text: string, color: string = C.text): TExoSchema => (
    <span static={{ style: `color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600` }}>{text}</span>
);
const rowSub = (text: string): TExoSchema => (
    <span static={{ style: `font-size:10px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-left:8px` }}>{text}</span>
);

const emptyState = (msg: string): TExoSchema => (
    <div static={{ style: 'padding:28px 20px;color:var(--text-muted);font-size:12px;text-align:center' }}>{msg}</div>
);

/** Wrap a reactive `combine(...)` bindable as a mountable schema (children swap). */
const bound = (children: unknown): TExoSchema => (
    <div static={{ style: 'display:contents' }} bindable={{ children: children as never }} />
);

// ── Stimulations list (windowed + infinite scroll) ─────────────────────────────
export function stimulationsList(ctrl: TCNSExplorerController): TExoSchema {
    return windowedScroller(
        [ctrl.rows, ctrl.query],
        () => ctrl.rows.getValue(),
        (r, top) => {
            const sel = ctrl.query.getValue().selected;
            return rowAbs(top, {
                accent:
                    r.status === 'failed'
                        ? C.red
                        : r.status === 'completed'
                          ? C.green
                          : C.yellow,
                active: sel === r.stimulationId,
                onClick: () => void ctrl.selectRun(r.stimulationId),
                left: (
                    <div static={{ style: 'display:flex;align-items:baseline' }}>
                        {rowTitle(r.entry.collateralName, C.cyan)}
                        {rowSub(r.stimulationId)}
                    </div>
                ),
                right: (
                    <div static={{ style: 'display:flex;align-items:center;gap:12px' }}>
                        <span static={{ style: `font-size:10px;color:${C.muted}` }}>{fmtTime(r.startedAt)}</span>
                        {metric(r.hopCount, 'hops', C.text)}
                        {statusPill(r.status)}
                    </div>
                ),
            });
        },
        'No stimulations yet — they appear as the app stimulates (or clear filters).',
        () => {
            if (ctrl.hasMore.getValue()) void ctrl.loadMore();
        }
    );
}

// ── Neurons list ───────────────────────────────────────────────────────────────
export function neuronsList(ctrl: TCNSExplorerController): TExoSchema {
    return windowedScroller(
        [ctrl.topology, ctrl.snapshot, ctrl.facets, ctrl.query],
        () =>
            buildNeuronRows(
                ctrl.topology.getValue(),
                ctrl.snapshot.getValue(),
                ctrl.facets.getValue()
            ),
        (n, top) => {
            const sel = ctrl.query.getValue().selectedNeuron;
            return rowAbs(top, {
                accent: n.errors > 0 ? C.red : C.violet,
                active: sel === n.name,
                onClick: () => openNeuron(ctrl, n.name, true),
                left: (
                    <div static={{ style: 'display:flex;align-items:baseline' }}>
                        {rowTitle(n.name, C.violet)}
                        {rowSub(`${n.dendrites} in · ${n.axons} out`)}
                    </div>
                ),
                right: (
                    <div static={{ style: 'display:flex;align-items:center;gap:12px' }}>
                        {metric(n.throughput, 'thru', C.green)}
                        {metric(n.errors, 'err', n.errors ? C.red : C.muted)}
                    </div>
                ),
            });
        },
        'No neurons yet — topology loads on connect.'
    );
}

// ── Collaterals list (with the entry-only boolean filter) ──────────────────────
export function collateralsList(ctrl: TCNSExplorerController): TExoSchema {
    return windowedScroller(
        [ctrl.topology, ctrl.snapshot, ctrl.query],
        () => {
            const q = ctrl.query.getValue();
            const rows = buildCollateralRows(
                ctrl.topology.getValue(),
                ctrl.snapshot.getValue()
            );
            return q.entryOnly ? rows.filter(c => c.isEntry) : rows;
        },
        (c, top) => {
            const sel = ctrl.query.getValue().selectedCollateral;
            // The left accent bar means: yellow = ENTRY collateral (no owner),
            // cyan = emitted by a neuron. That was opaque on its own, so the same
            // fact is now spelled out as a tag: "ENTRY" or "◦ axon of <neuron>".
            const preview = c.subscriberNames.slice(0, 3).join(' · ');
            const moreSubs = c.subscriberNames.length - 3;
            return rowAbs(top, {
                accent: c.isEntry ? C.yellow : C.cyan,
                active: sel === c.name,
                onClick: () => openCollateral(ctrl, c.name, true),
                left: (
                    <div static={{ style: 'display:flex;flex-direction:column;gap:3px;min-width:0' }}>
                        <div static={{ style: 'display:flex;align-items:center;gap:8px;min-width:0' }}>
                            {rowTitle(c.name, C.cyan)}
                            {c.isEntry
                                ? rowTag('entry', C.yellow)
                                : rowTag(`◦ axon of ${c.owner}`, C.violet)}
                        </div>
                        {/* where this collateral flows INTO (subscriber neurons via dendrites) */}
                        <div static={{ style: `display:flex;align-items:center;gap:5px;font-size:10px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis` }}>
                            {c.subscriberNames.length ? (
                                <span static={{ style: 'overflow:hidden;text-overflow:ellipsis' }}>
                                    <span static={{ style: `color:${C.muted}` }}>▸ into </span>
                                    <span static={{ style: `color:${C.violet}` }}>{preview}</span>
                                    {moreSubs > 0 ? <span static={{ style: `color:${C.muted}` }}>{` +${moreSubs}`}</span> : <span />}
                                </span>
                            ) : (
                                <span static={{ style: `color:${C.muted}` }}>▸ no subscribers</span>
                            )}
                        </div>
                    </div>
                ),
                right: (
                    <div static={{ style: 'display:flex;align-items:center;gap:12px' }}>
                        {metric(c.fires, 'fires', C.green)}
                        {metric(c.subscribers, 'subs', C.violet)}
                    </div>
                ),
            });
        },
        'No collaterals in range.'
    );
}

// ── Activation tasks list ──────────────────────────────────────────────────────
export function tasksList(ctrl: TCNSExplorerController): TExoSchema {
    return windowedScroller(
        [ctrl.snapshot, ctrl.query],
        () => {
            const q = ctrl.query.getValue();
            let rows = buildTaskRows(ctrl.snapshot.getValue());
            // The status filter applies to the TASK itself (so "Failed" surfaces the
            // failing activations across all stimulations), not just to its run.
            if (q.status) {
                const s = q.status.toLowerCase();
                rows = rows.filter(t => {
                    const ts = String(t.status).toLowerCase();
                    if (s === 'failed') return !!t.error || ts === 'failed';
                    if (s === 'completed')
                        return !t.error && (ts === 'done' || ts === 'completed' || ts === 'ok');
                    if (s === 'running') return ts === 'running';
                    return true;
                });
            }
            // Pin ONE activation task (by neuron) to see it fail across every run.
            if (q.neuronName) rows = rows.filter(t => t.neuronName === q.neuronName);
            return rows;
        },
        (t, top) => {
            const sel = ctrl.query.getValue().selectedTask;
            return rowAbs(top, {
                accent: t.error ? C.red : C.green,
                active: sel === t.key,
                onClick: () => openTask(ctrl, t.key, t.neuronName, true),
                left: (
                    <div static={{ style: 'display:flex;align-items:baseline' }}>
                        {rowTitle(t.neuronName, C.violet)}
                        {rowSub(`${t.input} → ${t.output ?? 'no output'}`)}
                    </div>
                ),
                right: (
                    <div static={{ style: 'display:flex;align-items:center;gap:12px' }}>
                        <span static={{ style: `font-size:10px;color:${C.muted};max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap` }}>{t.stimulationId}</span>
                        {statusPill(t.status)}
                    </div>
                ),
            });
        },
        'No activation tasks in the loaded snapshot yet.'
    );
}

// ── DETAIL: Neuron scope-card ──────────────────────────────────────────────────
// A side node is always a COLLATERAL (kind:'collateral'); its sub-line carries the
// ROLE (input/output), never "dendrite"/"axon" — those name the RELATIONSHIP (the
// edge/section), which lives in the section headings.
const collateralTarget = (
    ctrl: TCNSExplorerController,
    collateralName: string,
    role: string,
    count: number,
    error: number
): TDiagramTarget => ({
    id: collateralName,
    kind: 'collateral',
    title: collateralName,
    sub:
        count > 0
            ? `${role} · ${count}${error ? ` · ${error} err` : ''}`
            : `${role} · no traffic`,
    subColor: error ? C.red : undefined,
    weight: count,
    state: error > 0 ? 'error' : count > 0 ? 'ok' : 'idle',
    onClick: () => openCollateral(ctrl, collateralName),
});

export function neuronDetailView(ctrl: TCNSExplorerController): unknown {
    return combine([ctrl.topology, ctrl.snapshot, ctrl.neuronScope, ctrl.facets, ctrl.query], () => {
        const name = ctrl.query.getValue().selectedNeuron;
        if (!name) return <div />;
        // The neuron-scoped snapshot (its full recent history) when loaded; else the
        // bounded global snapshot. Both aggregates and activations read from it.
        const snap = ctrl.neuronScope.getValue() ?? ctrl.snapshot.getValue();
        const d = neuronDetail(
            name,
            ctrl.topology.getValue(),
            snap,
            ctrl.facets.getValue()
        );
        const diagram = nodeLinkDiagram({
            sourceKind: 'neuron',
            sourceLabel: name,
            leftHeading: 'INPUTS ▸ (via dendrites)',
            rightHeading: '(via axon) ◂ OUTPUTS',
            left: d.dendrites.map(c =>
                collateralTarget(ctrl, c.collateralName, 'input', c.count, c.error)
            ),
            right: d.axons.map(c =>
                collateralTarget(ctrl, c.collateralName, 'output', c.count, c.error)
            ),
        });
        const errRate = d.throughput ? d.errors / d.throughput : 0;
        const facts = factList([
            factBullet('input collaterals', `${d.dendrites.length}`, C.cyan),
            factBullet('output collaterals', `${d.axons.length}`, C.cyan),
            factBullet('errors', `${d.errors}`, d.errors ? C.red : C.muted),
            progressBar(errRate, `error rate — ${(errRate * 100).toFixed(1)}%`, errRate > 0 ? C.red : C.green),
        ]);
        const card = scopeCard({
            eyebrow: `NEURON · SCOPE`,
            eyebrowColor: C.violet,
            title: name,
            description:
                'A NEURON (violet box). It reacts to its INPUT collaterals (via dendrites, left) and emits its OUTPUT collaterals (via its axon, right). Every side node is a collateral — click one to open it.',
            pills: [
                <div static={{ style: 'display:flex;align-items:center;gap:10px' }}>
                    {bigStat(d.throughput, 'throughput', C.green)}
                </div>,
            ],
            diagram,
            facts,
        });
        // ACTIVATIONS: every activation task of this neuron (from the neuron-scoped
        // snapshot — its full recent history), each joined to its STIMULATION.
        const acts = buildTaskRows(snap).filter(t => t.neuronName === name);
        const runs = new Set(acts.map(t => t.stimulationId)).size;
        const actRow = (t: (typeof acts)[number]): TExoSchema => {
            const ci = t.key.lastIndexOf(':');
            const stage = Number(t.key.slice(ci + 1)) + 1;
            return (
                <div
                    static={{
                        class: 'exp-act-row',
                        title: 'Open this activation task',
                        style: `display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border:1px solid var(--border-primary);border-left:3px solid ${t.error ? C.red : C.green};border-radius:6px;background:var(--bg-secondary)`,
                    }}
                    handlers={{ onClick: () => openTask(ctrl, t.key, t.neuronName) }}
                >
                    <span static={{ style: `flex:none;font-size:9px;letter-spacing:.5px;text-transform:uppercase;padding:1px 7px;border-radius:999px;border:1px solid ${(t.error ? C.red : C.green)}66;color:${t.error ? C.red : C.green};background:${(t.error ? C.red : C.green)}14` }}>
                        {Number.isFinite(stage) ? `stage ${stage}` : 'task'}
                    </span>
                    <span static={{ style: `font-size:11px;color:${C.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap` }}>
                        ◦ {t.input} → {t.output ? `◦ ${t.output}` : 'no output'}
                    </span>
                    <div static={{ style: 'flex:1;min-width:8px' }} />
                    <span static={{ style: `flex:none;font-size:10px;color:${C.yellow};max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap` }}>⚡ {t.stimulationId}</span>
                    {statusPill(t.status)}
                </div>
            );
        };
        const activations = (
            <div static={{ style: 'display:flex;flex-direction:column;gap:8px;padding:16px;padding-top:0' }}>
                <div static={{ style: 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap' }}>
                    {eyebrow('Activations', C.violet)}
                    <span static={{ style: `font-size:10px;color:${C.muted}` }}>
                        {acts.length
                            ? `${acts.length} task${acts.length === 1 ? '' : 's'} · ${runs} run${runs === 1 ? '' : 's'}` +
                              (acts.length > 60 ? ` · showing newest 60` : '') +
                              ` · click a row to open the task`
                            : ''}
                    </span>
                </div>
                {acts.length ? (
                    <div static={{ style: 'display:flex;flex-direction:column;gap:6px' }}>
                        {acts.slice(0, 60).map(actRow)}
                    </div>
                ) : (
                    <div static={{ style: `font-size:11px;color:${C.muted}` }}>No activations of this neuron in the loaded snapshot yet.</div>
                )}
            </div>
        );
        return (
            <div static={{ style: 'display:flex;flex-direction:column' }}>
                {card}
                {activations}
            </div>
        );
    });
}

// ── DETAIL: Collateral scope-card ──────────────────────────────────────────────
export function collateralDetailView(ctrl: TCNSExplorerController): unknown {
    return combine([ctrl.topology, ctrl.snapshot, ctrl.query], () => {
        const name = ctrl.query.getValue().selectedCollateral;
        if (!name) return <div />;
        const d = collateralDetail(name, ctrl.topology.getValue(), ctrl.snapshot.getValue());
        const left: TDiagramTarget[] = d.owner
            ? [
                  {
                      id: d.owner,
                      kind: 'neuron',
                      title: d.owner,
                      sub: 'owner · emits (axon)',
                      weight: Math.max(1, d.fires),
                      state: 'ok',
                      onClick: () => openNeuron(ctrl, d.owner as string),
                  },
              ]
            : [];
        const right: TDiagramTarget[] = d.subscribers.map(s => ({
            id: s.neuronName,
            kind: 'neuron',
            title: s.neuronName,
            sub:
                s.count > 0
                    ? `subscriber · ${s.count}${s.error ? ` · ${s.error} err` : ''}`
                    : 'subscriber · no traffic',
            subColor: s.error ? C.red : undefined,
            weight: s.count,
            state: s.error > 0 ? 'error' : s.count > 0 ? 'ok' : 'idle',
            onClick: () => openNeuron(ctrl, s.neuronName),
        }));
        const diagram = nodeLinkDiagram({
            sourceKind: 'collateral',
            sourceLabel: name,
            leftHeading: 'OWNER NEURON ▸',
            rightHeading: '◂ SUBSCRIBER NEURONS (via dendrites)',
            left,
            right,
        });
        const facts = factList([
            factBullet('owner', d.isEntry ? 'entry' : '1', d.isEntry ? C.yellow : C.green),
            factBullet('subscribers', `${d.subscribers.length}`, C.violet),
            factBullet('fires', `${d.fires}`, C.green),
        ]);
        const card = scopeCard({
            eyebrow: d.isEntry ? 'COLLATERAL · ENTRY' : 'COLLATERAL · SCOPE',
            eyebrowColor: C.cyan,
            title: name,
            description: d.isEntry
                ? 'A COLLATERAL (cyan pill) — this one is an ENTRY collateral: no owning neuron, stimulations enter the graph here. The NEURONS on the right react to it. Click any neuron to open it.'
                : 'A COLLATERAL (cyan pill). It is emitted by its OWNER neuron (left) and reacted to by its SUBSCRIBER neurons (right, via their dendrites). Every side node is a neuron — click one to open it.',
            pills: [
                <div static={{ style: 'display:flex;align-items:center;gap:10px' }}>
                    {bigStat(d.fires, 'fires', C.green)}
                    {d.isEntry ? statusPill('entry') : <div />}
                </div>,
            ],
            diagram,
            facts,
        });
        // DISPATCHES: this collateral's link to activation tasks — every emission,
        // with which run, at what stage, by which neuron, and the payload it carried.
        const previewPayload = (p: unknown): string => {
            if (p === undefined) return '—';
            try {
                const s = typeof p === 'string' ? p : JSON.stringify(p);
                return s.length > 400 ? s.slice(0, 400) + '…' : s;
            } catch {
                return String(p);
            }
        };
        const dispatchRow = (x: (typeof d.dispatches)[number]): TExoSchema => (
            <div static={{ style: `display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--border-primary);border-left:3px solid ${x.error ? C.red : x.isEntry ? C.yellow : C.green};border-radius:6px;background:var(--bg-secondary)` }}>
                <div static={{ style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }}>
                    <span static={{ style: `flex:none;font-size:9px;letter-spacing:.5px;text-transform:uppercase;padding:1px 7px;border-radius:999px;border:1px solid ${x.isEntry ? C.yellow : C.green}66;color:${x.isEntry ? C.yellow : C.green};background:${(x.isEntry ? C.yellow : C.green)}14` }}>
                        {x.isEntry ? 'entry' : `stage ${x.stage + 1}`}
                    </span>
                    {x.isEntry ? (
                        <span static={{ style: `font-size:11px;color:${C.muted}` }}>entry signal</span>
                    ) : (
                        <span
                            static={{ class: 'exp-link', style: `font-size:11px;color:${C.violet};cursor:pointer` }}
                            handlers={{ onClick: () => openNeuron(ctrl, x.neuronName) }}
                        >
                            ▪ {x.neuronName}
                        </span>
                    )}
                    <div static={{ style: 'flex:1' }} />
                    <span
                        static={{ class: 'exp-link', title: x.stimulationId, style: `font-size:10px;color:${C.muted};cursor:pointer;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap` }}
                        handlers={{ onClick: () => ctrl.openEntity({ kind: 'stimulation', id: x.stimulationId, label: x.stimulationId }) }}
                    >
                        ⚡ {x.stimulationId}
                    </span>
                </div>
                <code static={{ style: `font-size:10px;color:${C.sub};font-family:var(--font-mono, monospace);white-space:pre-wrap;word-break:break-all;max-height:110px;overflow:auto;background:var(--bg-primary);padding:5px 7px;border-radius:4px` }}>
                    {previewPayload(x.payload)}
                </code>
                {x.error ? (
                    <div static={{ style: `font-size:10px;color:${C.red}` }}>⌐ {x.error}</div>
                ) : (
                    <span />
                )}
            </div>
        );
        const dispatchesSection = (
            <div static={{ style: 'display:flex;flex-direction:column;gap:8px;padding:16px;padding-top:0' }}>
                <div static={{ style: 'display:flex;align-items:baseline;gap:8px' }}>
                    {eyebrow('Dispatches', C.cyan)}
                    <span static={{ style: `font-size:10px;color:${C.muted}` }}>
                        {d.dispatches.length ? `${d.dispatches.length} recent emission${d.dispatches.length === 1 ? '' : 's'} · payload · run · stage` : ''}
                    </span>
                </div>
                {d.dispatches.length ? (
                    <div static={{ style: 'display:flex;flex-direction:column;gap:6px' }}>
                        {d.dispatches.map(dispatchRow)}
                    </div>
                ) : (
                    <div static={{ style: `font-size:11px;color:${C.muted}` }}>No dispatches of this collateral in the loaded snapshot yet.</div>
                )}
            </div>
        );
        return (
            <div static={{ style: 'display:flex;flex-direction:column' }}>
                {card}
                {dispatchesSection}
            </div>
        );
    });
}

// ── DETAIL: Activation-task scope-card ─────────────────────────────────────────
export function taskDetailView(ctrl: TCNSExplorerController): unknown {
    return combine([ctrl.snapshot, ctrl.detail, ctrl.query], () => {
        const key = ctrl.query.getValue().selectedTask;
        if (!key) return <div />;
        // Search the live snapshot first; fall back to the currently-open
        // stimulation's detail (a task drilled from the pipeline may be an old run
        // that is no longer in the newest-N snapshot).
        const d = ctrl.detail.getValue();
        const detailRows = d
            ? buildTaskRows({ stimulations: [], attempts: d.attempts, tasks: d.tasks })
            : [];
        const t =
            buildTaskRows(ctrl.snapshot.getValue()).find(x => x.key === key) ??
            detailRows.find(x => x.key === key);
        if (!t) return emptyState('Task not found in the current snapshot.');
        const accent = t.error
            ? C.red
            : String(t.status).toLowerCase() === 'running'
              ? C.yellow
              : C.green;
        // stage = the task index within the run (key = `${attemptId}:${index}`).
        const ci = t.key.lastIndexOf(':');
        const idx = ci >= 0 ? Number(t.key.slice(ci + 1)) : NaN;
        const stage = Number.isFinite(idx) ? idx + 1 : null;

        // The raw task carries the OUTPUT signal payload (buildTaskRows drops it).
        // The INPUT signal payload is the signal that FED this task: the latest
        // earlier task in the same attempt that emitted this input collateral, else
        // the run's ENTRY signal on that collateral.
        const rawTasks = [...ctrl.snapshot.getValue().tasks, ...(d?.tasks ?? [])];
        const raw = rawTasks.find(
            rt => `${rt.stimulationAttemptId}:${rt.index}` === key
        );
        const hasOutput = !!raw && raw.output != null;
        const outputPayload = raw?.output?.payload;
        let inputPayload: unknown;
        let hasInput = false;
        if (raw) {
            const producer = rawTasks
                .filter(
                    rt =>
                        rt.stimulationAttemptId === raw.stimulationAttemptId &&
                        rt.index < raw.index &&
                        rt.output?.collateralName === raw.dendriteCollateralName
                )
                .sort((a, b) => b.index - a.index)[0];
            if (producer) {
                inputPayload = producer.output?.payload;
                hasInput = true;
            } else {
                const entrySignals = [
                    ...(d?.attempts ?? []).flatMap(a => a.entry ?? []),
                    ...ctrl.snapshot.getValue().stimulations.map(s => s.entry),
                ].filter(Boolean);
                const es = entrySignals.find(
                    s => s && s.collateralName === raw.dendriteCollateralName
                );
                if (es) {
                    inputPayload = es.payload;
                    hasInput = true;
                }
            }
        }
        const previewPayload = (p: unknown): string => {
            try {
                const s = typeof p === 'string' ? p : JSON.stringify(p, null, 2);
                return s == null ? 'null' : s.length > 2000 ? s.slice(0, 2000) + '…' : s;
            } catch {
                return String(p);
            }
        };
        const payloadBlock = (
            label: string,
            payload: unknown,
            present: boolean,
            color: string
        ): TExoSchema => (
            <div static={{ style: 'display:flex;flex-direction:column;gap:4px' }}>
                <span static={{ style: `font-size:9px;letter-spacing:1px;text-transform:uppercase;color:${color}` }}>{label}</span>
                <code static={{ style: `font-size:10.5px;color:${present ? C.sub : C.muted};font-family:var(--font-mono, monospace);white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;background:var(--bg-primary);border:1px solid var(--border-primary);padding:6px 8px;border-radius:4px` }}>
                    {present ? previewPayload(payload) : '— not in the loaded snapshot —'}
                </code>
            </div>
        );

        // A plain key→value row (NON-navigable: this screen doesn't let you travel
        // the graph — the neuron TAG above is the way to the neuron screen).
        const kv = (
            k: string,
            v: string,
            color: string = C.text,
            onClick?: () => void
        ): TExoSchema => (
            <div static={{ style: 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--border-secondary)' }}>
                <span static={{ style: `font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:${C.muted};white-space:nowrap` }}>{k}</span>
                {onClick ? (
                    <span
                        static={{ class: 'exp-link', style: `font-size:12px;color:${color};cursor:pointer;text-align:right;word-break:break-all` }}
                        handlers={{ onClick }}
                    >
                        {v}
                    </span>
                ) : (
                    <span static={{ style: `font-size:12px;color:${color};text-align:right;word-break:break-all;font-variant-numeric:tabular-nums` }}>{v}</span>
                )}
            </div>
        );

        return (
            <div static={{ style: 'display:flex;flex-direction:column;gap:14px;padding:16px' }}>
                <div static={{ style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }}>
                    {eyebrow('ACTIVATION TASK', accent)}
                    {statusPill(t.status)}
                    <span static={{ style: `font-size:11px;color:${C.muted}` }}>{stage != null ? `stage ${stage}` : ''}</span>
                </div>
                {/* the neuron identity IS a clickable tag → opens the neuron screen */}
                <button
                    static={{
                        class: 'exp-open-neuron',
                        title: 'Open the neuron screen',
                        style:
                            `align-self:flex-start;display:inline-flex;align-items:center;gap:8px;padding:5px 13px;cursor:pointer;border-radius:999px;` +
                            `font-size:15px;font-weight:700;border:1px solid ${C.violet}66;color:${C.violet};background:${C.violet}14`,
                    }}
                    handlers={{ onClick: () => openNeuron(ctrl, t.neuronName) }}
                >
                    ▪ {t.neuronName} ›
                </button>
                {/* this activation's own facts (plain, non-navigable) */}
                <div static={{ style: 'display:flex;flex-direction:column;padding:2px 12px;border:1px solid var(--border-primary);border-radius:8px;background:var(--bg-secondary)' }}>
                    {kv('stage', stage != null ? `#${stage}` : '—', accent)}
                    {kv('input collateral', `◦ ${t.input}`, C.cyan)}
                    {kv('output collateral', t.output ? `◦ ${t.output}` : 'no output', t.output ? C.cyan : C.muted)}
                    {kv('attempt', `#${t.attemptNumber}`, C.violet)}
                    {kv('duration', t.duration != null ? `${t.duration}ms` : '—')}
                    {kv('started', fmtTime(t.startedAt), C.muted)}
                    {kv('run', `⚡ ${t.stimulationId}`, C.yellow, () =>
                        ctrl.openEntity({ kind: 'stimulation', id: t.stimulationId, label: t.stimulationId })
                    )}
                </div>
                {/* input & output SIGNAL payloads for this activation */}
                {payloadBlock(`◦ ${t.input} — input signal payload`, inputPayload, hasInput, C.cyan)}
                {payloadBlock(t.output ? `◦ ${t.output} — output signal payload` : 'output signal — no output', outputPayload, hasOutput, C.green)}
                {t.error ? (
                    <div static={{ style: `font-size:11px;color:${C.red};padding:8px 10px;border:1px solid ${C.red}55;border-radius:6px;background:${C.red}12` }}>⌐ {t.error}</div>
                ) : (
                    <span />
                )}
            </div>
        );
    });
}

// ── DETAIL: Stimulation pipeline (the elegant waterfall) ───────────────────────
const pipeConnector = (color: string, flowing: boolean): TExoSchema => (
    <div
        static={{
            style: 'flex:none;width:34px;height:44px;display:flex;align-items:center',
            onExoMount: (n: { element: unknown }) => {
                const host = n.element as HTMLElement;
                const NS = 'http://www.w3.org/2000/svg';
                const reduced =
                    typeof matchMedia === 'function' &&
                    matchMedia('(prefers-reduced-motion: reduce)').matches;
                const svg = document.createElementNS(NS, 'svg');
                svg.setAttribute('viewBox', '0 0 34 44');
                (svg as SVGSVGElement).style.cssText = 'width:34px;height:44px';
                const path = document.createElementNS(NS, 'path');
                const id = `pc-${Math.random().toString(36).slice(2)}`;
                path.setAttribute('id', id);
                path.setAttribute('d', 'M2 22 C 12 22 22 22 32 22');
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', color);
                path.setAttribute('stroke-width', '2');
                path.setAttribute('opacity', '0.8');
                (path as SVGElement).style.filter = `drop-shadow(0 0 2px ${color})`;
                svg.appendChild(path);
                if (flowing) {
                    const dot = document.createElementNS(NS, 'circle');
                    dot.setAttribute('r', '3');
                    dot.setAttribute('fill', '#eafbc7');
                    (dot as SVGElement).style.filter = `drop-shadow(0 0 3px ${color})`;
                    if (reduced) {
                        dot.setAttribute('cx', '17');
                        dot.setAttribute('cy', '22');
                    } else {
                        const am = document.createElementNS(NS, 'animateMotion');
                        am.setAttribute('dur', '1.4s');
                        am.setAttribute('repeatCount', 'indefinite');
                        const mp = document.createElementNS(NS, 'mpath');
                        mp.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${id}`);
                        mp.setAttribute('href', `#${id}`);
                        am.appendChild(mp);
                        dot.appendChild(am);
                    }
                    svg.appendChild(dot);
                }
                host.appendChild(svg);
            },
        }}
    />
);

const stageBox = (
    n: number,
    name: string,
    state: 'ok' | 'error' | 'running',
    onClick?: () => void
): TExoSchema => {
    const col = state === 'error' ? C.red : state === 'running' ? C.yellow : C.green;
    return (
        <div
            static={{
                class: onClick ? 'exp-stage' : '',
                title: onClick ? `Open activation task · ${name}` : name,
                style:
                    `flex:none;min-width:64px;max-width:120px;padding:6px 8px;border-radius:8px;text-align:center;` +
                    `border:1.5px solid ${col};background:${col}12;` +
                    (onClick ? 'cursor:pointer;' : '') +
                    (state === 'error' ? 'box-shadow:0 0 8px ' + C.red + '55;' : ''),
            }}
            handlers={{ onClick: () => onClick && onClick() }}
        >
            <div static={{ style: `font-size:16px;font-weight:700;color:${col};font-family:var(--font-body)` }}>{String(n)}</div>
            <div static={{ style: `font-size:9px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis` }}>{name}</div>
        </div>
    );
};

const actionBtn = (
    text: string,
    color: string,
    enabled: boolean,
    onClick: () => void
): TExoSchema => (
    <button
        static={{
            style:
                `padding:4px 14px;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-radius:4px;` +
                `border:1px solid ${enabled ? color : C.border};` +
                (enabled
                    ? `cursor:pointer;background:${color}1a;color:${color}`
                    : 'cursor:not-allowed;background:var(--bg-secondary);color:var(--text-muted);opacity:.5'),
        }}
        handlers={{ onClick: () => enabled && onClick() }}
    >
        {text}
    </button>
);

export function stimulationDetailView(ctrl: TCNSExplorerController): unknown {
    return combine(
        [ctrl.detail, ctrl.query, ctrl.actionError, ctrl.actionNotice],
        () => {
            const q = ctrl.query.getValue();
            const d = ctrl.detail.getValue();
            const run = q.selected;
            if (!run) return <div />;
            if (!d)
                return <div static={{ style: 'padding:16px;color:var(--text-muted);font-size:12px' }}>Loading stimulation…</div>;
            const err = ctrl.actionError.getValue();
            const notice = ctrl.actionNotice.getValue();
            const lastAttempt = d.attempts[d.attempts.length - 1];
            const retryable = !!lastAttempt && (lastAttempt.status === 'failed' || lastAttempt.hasError);
            const entryName = lastAttempt?.entry?.[0]?.collateralName ?? '—';
            const resultStatus = lastAttempt?.hasError ? 'failed' : lastAttempt?.status ?? 'running';
            const hops = lastAttempt?.hopCount ?? d.tasks.length;

            const attemptTasks = d.tasks
                .filter(t => t.stimulationAttemptId === lastAttempt?.stimulationAttemptId)
                .sort((a, b) => a.index - b.index);
            const stages: TExoSchema[] = [];
            attemptTasks.forEach((t, i) => {
                // History tasks are terminal ('done' | 'failed'); non-error ⇒ ok.
                const st: 'ok' | 'error' | 'running' = t.error
                    ? 'error'
                    : String(t.status) === 'running'
                      ? 'running'
                      : 'ok';
                if (i > 0)
                    stages.push(pipeConnector(t.error ? C.red : C.green, true));
                // Clicking a stage opens that activation task (pushes onto the
                // breadcrumb, so ← back returns to this stimulation).
                const taskKey = `${t.stimulationAttemptId}:${t.index}`;
                stages.push(
                    stageBox(t.index + 1, t.neuronName, st, () =>
                        openTask(ctrl, taskKey, t.neuronName)
                    )
                );
            });
            const failedIdx = attemptTasks.findIndex(t => !!t.error);

            const feedback = notice ? (
                <div static={{ class: 'exp-toast', style: `padding:6px 10px;font-size:12px;color:var(--bg-primary);background:${C.green};border-radius:4px;word-break:break-all` }}>✓ {notice}</div>
            ) : err ? (
                <div static={{ class: 'exp-toast', style: `padding:6px 10px;font-size:12px;color:var(--bg-primary);background:${C.red};border-radius:4px;word-break:break-all` }}>✕ {err}</div>
            ) : (
                <div />
            );

            const entryCard = (
                <div static={{ style: `flex:none;min-width:120px;padding:10px 12px;border:1px solid ${C.violet}66;border-radius:8px;background:${C.violet}0f` }}>
                    {eyebrow('ENTRY', C.violet)}
                    <div static={{ style: `font-size:13px;color:${C.cyan};margin-top:4px;word-break:break-all` }}>{entryName}</div>
                    <div static={{ style: `font-size:9px;color:${C.muted};margin-top:6px;letter-spacing:1px;text-transform:uppercase` }}>{d.attempts.length} attempt{d.attempts.length > 1 ? 's' : ''}</div>
                </div>
            );
            const resultColor =
                resultStatus === 'failed' ? C.red : resultStatus === 'completed' ? C.green : C.yellow;
            const resultCard = (
                <div static={{ style: `flex:none;min-width:120px;padding:10px 12px;border:1px solid ${resultColor}66;border-radius:8px;background:${resultColor}0f` }}>
                    {eyebrow('RESULT', resultColor)}
                    <div static={{ style: 'margin-top:6px' }}>{statusPill(resultStatus)}</div>
                    <div static={{ style: `font-size:9px;color:${C.muted};margin-top:6px;letter-spacing:1px;text-transform:uppercase` }}>{hops} hops</div>
                </div>
            );

            return (
                <div static={{ style: 'display:flex;flex-direction:column;gap:14px;padding:16px' }}>
                    <div static={{ style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }}>
                        {eyebrow(`STIMULATION · FLOW`, C.yellow)}
                        <div static={{ style: 'flex:1' }} />
                        {actionBtn('Retry', C.green, retryable, () => void ctrl.retryRun(run))}
                        {actionBtn('Clone', C.cyan, true, () => void ctrl.cloneRun(run))}
                    </div>
                    <div static={{ style: `font-size:11px;color:${C.muted};word-break:break-all` }}>{run}</div>
                    {feedback}
                    {/* pipeline: entry → stages → result */}
                    <div static={{ style: 'display:flex;align-items:stretch;gap:12px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:6px' }}>
                        {entryCard}
                        {pipeConnector(C.violet, true)}
                        <div static={{ style: `flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid ${C.border};border-radius:10px;background:radial-gradient(120% 120% at 0% 0%, #202020, #161616)` }}>
                            <div static={{ style: 'display:flex;align-items:center;gap:0;overflow-x:auto' }}>
                                {stages.length ? stages : <span static={{ style: `font-size:11px;color:${C.muted}` }}>no hops recorded</span>}
                            </div>
                            {failedIdx >= 0 ? (
                                <div static={{ style: `font-size:10px;color:${C.red};letter-spacing:.5px` }}>⌐ failed at stage {failedIdx + 1} · {attemptTasks[failedIdx].neuronName}</div>
                            ) : (
                                <div static={{ style: `font-size:10px;color:${C.muted}` }}>{attemptTasks.length} activation tasks</div>
                            )}
                        </div>
                        {pipeConnector(resultColor, resultStatus !== 'failed')}
                        {resultCard}
                    </div>
                    {/* attempts breakdown (if replayed) */}
                    {d.attempts.length > 1 ? (
                        <div static={{ style: 'display:flex;flex-direction:column;gap:6px' }}>
                            {eyebrow('ATTEMPTS', C.violet)}
                            {d.attempts.map(a => (
                                <div static={{ style: `display:flex;align-items:center;gap:10px;font-size:11px;padding:4px 8px;border-left:2px solid ${a.hasError ? C.red : C.green}` }}>
                                    <span static={{ style: `color:${C.text}` }}>#{String(a.attemptNumber)}</span>
                                    {statusPill(a.hasError ? 'failed' : a.status)}
                                    <span static={{ style: `color:${C.muted}` }}>{String(a.hopCount)} hops</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div />
                    )}
                </div>
            );
        }
    );
}

// ── VIEW list selector (by tab) + DETAILS selector (by selection) ──────────────
/** A bindable that swaps the VIEW list by the active tab (bind via `children`). */
export function viewList(ctrl: TCNSExplorerController): unknown {
    const lists = {
        stimulations: stimulationsList(ctrl),
        neurons: neuronsList(ctrl),
        collaterals: collateralsList(ctrl),
        tasks: tasksList(ctrl),
    };
    return combine([ctrl.query], () => {
        const tab = ctrl.query.getValue().tab;
        return lists[tab];
    });
}

/** A bindable that swaps the DETAILS scope-card by the current selection. */
export function detailsPane(ctrl: TCNSExplorerController): unknown {
    const neuron = bound(neuronDetailView(ctrl));
    const collateral = bound(collateralDetailView(ctrl));
    const task = bound(taskDetailView(ctrl));
    const stimulation = bound(stimulationDetailView(ctrl));
    const hint = (
        <div static={{ style: 'flex:1;display:flex;align-items:center;justify-content:center;padding:32px;text-align:center' }}>
            <div static={{ style: 'display:flex;flex-direction:column;gap:8px;align-items:center;max-width:280px' }}>
                <span static={{ style: `font-size:22px` }}>🧬</span>
                {eyebrow('DETAILS', C.violet)}
                <div static={{ style: `font-size:12px;color:${C.muted};line-height:1.5` }}>
                    Select a row to inspect it here — its scope card, connections and live signal flow appear beside the list.
                </div>
            </div>
        </div>
    );
    return combine([ctrl.query], () => {
        const q = ctrl.query.getValue();
        let content: TExoSchema = hint;
        if (q.selected) content = stimulation;
        else if (q.selectedNeuron) content = neuron;
        else if (q.selectedCollateral) content = collateral;
        else if (q.selectedTask) content = task;
        return content;
    });
}

// ── DETAILS breadcrumb / back navigation ───────────────────────────────────────
const KIND_STYLE: Record<string, { color: string; glyph: string }> = {
    stimulation: { color: C.yellow, glyph: '⚡' },
    neuron: { color: C.violet, glyph: '▪' },
    collateral: { color: C.cyan, glyph: '◦' },
    task: { color: C.green, glyph: '⚙' },
};

/** A bindable header for the DETAILS panel: ← back + a clickable breadcrumb trail. */
export function breadcrumb(ctrl: TCNSExplorerController): unknown {
    return combine([ctrl.navStack], () => {
        const stack = ctrl.navStack.getValue();
        if (!stack.length) return eyebrow('Details', C.violet);
        const back = (
            <button
                static={{
                    title: 'Back to the previous entity',
                    class: 'exp-crumb-back',
                    style:
                        `display:inline-flex;align-items:center;gap:4px;padding:3px 9px;font-size:10px;cursor:pointer;border-radius:4px;` +
                        `text-transform:uppercase;letter-spacing:.5px;border:1px solid ${C.pink};color:${C.pink};background:${C.pink}1a;flex:none`,
                }}
                handlers={{ onClick: () => ctrl.navBack() }}
            >
                ← back
            </button>
        );
        const crumbs: TExoSchema[] = [];
        stack.forEach((entry, i) => {
            const st = KIND_STYLE[entry.kind] ?? { color: C.muted, glyph: '·' };
            const isLast = i === stack.length - 1;
            if (i > 0)
                crumbs.push(
                    <span static={{ style: `color:${C.muted};font-size:11px;flex:none` }}>›</span>
                );
            crumbs.push(
                <button
                    static={{
                        class: isLast ? '' : 'exp-crumb',
                        title: `${entry.kind}: ${entry.label}`,
                        style:
                            `display:inline-flex;align-items:center;gap:4px;font-size:11px;border:none;background:none;padding:0;flex:none;` +
                            `max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;` +
                            (isLast
                                ? `color:${st.color};font-weight:700;cursor:default`
                                : `color:${C.sub};cursor:pointer`),
                    }}
                    handlers={isLast ? {} : { onClick: () => ctrl.navTo(i) }}
                >
                    <span static={{ style: `color:${st.color};flex:none` }}>{st.glyph}</span>
                    <span static={{ style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }}>{entry.label}</span>
                </button>
            );
        });
        // A long trail must NOT wrap (that grows the header and shoves the card down).
        // One nowrap row that scrolls horizontally, auto-scrolled to the current crumb.
        return (
            <div static={{ style: 'display:flex;align-items:center;gap:8px;min-width:0' }}>
                {back}
                <div
                    static={{
                        style: 'display:flex;align-items:center;gap:6px;flex-wrap:nowrap;overflow-x:auto;min-width:0;flex:1;scrollbar-width:thin;padding-bottom:2px',
                        onExoMount: (n: { element: unknown }) => {
                            const el = n.element as HTMLElement;
                            el.scrollLeft = el.scrollWidth; // reveal the current (last) crumb
                        },
                    }}
                >
                    {crumbs}
                </div>
            </div>
        );
    });
}
