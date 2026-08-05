import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import { fmtTime } from '../utils/format';
import type { TCNSExplorerController } from './explorerController';
import { toggleFilter } from './queryState';
import type {
    TCNSStimulationRowDTO,
    TCNSStimulationTimeBucket,
} from '@cnstra/devtools-dto';
import type { ConnectionStatus } from '../app/controllers/socket';
import { heartbeatMonitor } from './HeartbeatMonitor';

// The Explorer IS the whole DevTools panel — an observability / runs viewer
// (think Sentry issues · CI runs). One top bar (identity + health · search ·
// view tabs · metric · heartbeat · run count), ONE secondary column (the compact
// facet rail = the primary filter/nav), and a main area that shows the runs list
// (Runs), a selected run's step timeline (Waterfall) or throughput (Chart). All
// state lives in the controller; this view only reads bindables + dispatches
// patches. No sidebar, no graph, no landing page — opening the panel lands here.

const ROW_H = 44; // px, fixed → enables windowing
const OVERSCAN = 6;

/** Connection identity + health, folded into the top bar (was the old sidebar). */
export interface TCNSExplorerConnection {
    connectionStatus: TExoWritableBindable<ConnectionStatus, ConnectionStatus>;
    appName: TExoWritableBindable<string, string>;
}

const chip = (
    label: string,
    count: number | null,
    active: boolean,
    onClick: () => void
): TExoSchema => (
    <button
        static={{
            class: 'exp-chip',
            style:
                `border:1px solid ${active ? 'var(--infection-purple)' : 'var(--border-primary)'};` +
                `color:${active ? 'var(--bg-primary)' : 'var(--text-secondary)'};` +
                `background:${active ? 'var(--infection-purple)' : 'var(--bg-card)'};` +
                'padding:3px 8px;font-size:11px;cursor:pointer;white-space:nowrap;border-radius:2px',
        }}
        handlers={{ onClick }}
    >
        {label}
        {count != null ? ` · ${count}` : ''}
    </button>
);

export function explorerPage(
    ctrl: TCNSExplorerController,
    conn: TCNSExplorerConnection
): TExoSchema {
    // Scroll offset drives the window; a ResizeObserver-free height guess is fine
    // (the container is a fixed flex child).
    const scrollTop = bindable(0);
    const viewportH = bindable(600);

    // ── top-bar identity + health (brand · connection dot · app name) ─────────
    const dotColor = (s: ConnectionStatus): string =>
        s === 'connected'
            ? 'var(--infection-green)'
            : s === 'connecting'
              ? 'var(--infection-yellow)'
              : 'var(--infection-red)';
    const connBlock = combine([conn.connectionStatus, conn.appName], () => {
        const s = conn.connectionStatus.getValue();
        const name = conn.appName.getValue();
        const label =
            s === 'connected'
                ? name || 'Server Connected'
                : s === 'connecting'
                  ? 'Connecting…'
                  : 'Disconnected';
        return (
            <div
                static={{
                    title: `Server ${s}`,
                    style: 'display:flex;align-items:center;gap:8px;flex:none',
                }}
            >
                <span static={{ class: 'brand', style: 'font-size:16px;color:var(--text-primary);white-space:nowrap' }}>
                    🧠 CNStra
                </span>
                <span static={{ style: `width:9px;height:9px;border-radius:50%;flex:none;background:${dotColor(s)};box-shadow:0 0 6px ${dotColor(s)}` }} />
                <span static={{ style: 'font-size:12px;color:var(--text-secondary);white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis' }}>
                    {label}
                </span>
            </div>
        );
    });

    // ── facet rail (left), with a Collaterals ⇄ Neurons lens ─────────────────
    const lensBtn = (
        lens: 'collaterals' | 'neurons',
        label: string,
        active: boolean
    ): TExoSchema => (
        <button
            static={{
                style:
                    'flex:1;padding:4px;font-size:10px;text-transform:uppercase;letter-spacing:1px;cursor:pointer;' +
                    `border:1px solid var(--border-primary);` +
                    (active
                        ? 'background:var(--infection-purple);color:var(--bg-primary)'
                        : 'background:var(--bg-card);color:var(--text-secondary)'),
            }}
            handlers={{ onClick: () => ctrl.setQuery({ lens }) }}
        >
            {label}
        </button>
    );
    // Section labels are HEADINGS → pixel font (.exp-heading) + bright yellow.
    const label = (t: string): TExoSchema => (
        <div static={{ class: 'exp-heading', style: 'font-size:11px;letter-spacing:1.5px;color:var(--infection-yellow);text-transform:uppercase;margin-bottom:6px' }}>{t}</div>
    );
    const facetRail = combine([ctrl.facets, ctrl.query], () => {
        const f = ctrl.facets.getValue();
        const q = ctrl.query.getValue();
        const neurons = q.lens === 'neurons';
        const dim = neurons ? f.byNeuron : f.byEntryCollateral;
        return (
            <div static={{ style: 'display:flex;flex-direction:column;gap:14px' }}>
                <div static={{ style: 'display:flex;gap:2px' }}>
                    {[
                        lensBtn('collaterals', 'Collaterals', !neurons),
                        lensBtn('neurons', 'Neurons', neurons),
                    ]}
                </div>
                <div>
                    {label('Status')}
                    <div static={{ style: 'display:flex;flex-wrap:wrap;gap:5px' }}>
                        {f.byStatus.map(s =>
                            chip(s.status, s.count, q.status === s.status, () =>
                                ctrl.setQuery(toggleFilter(q, 'status', s.status))
                            )
                        )}
                    </div>
                </div>
                <div>
                    {label(neurons ? 'Neuron' : 'Job type')}
                    <div static={{ style: 'display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow:auto' }}>
                        {dim.map(c =>
                            chip(
                                c.name,
                                c.count,
                                (neurons ? q.neuronName : q.entryCollateralName) === c.name,
                                () =>
                                    ctrl.setQuery(
                                        toggleFilter(
                                            q,
                                            neurons ? 'neuronName' : 'entryCollateralName',
                                            c.name
                                        )
                                    )
                            )
                        )}
                    </div>
                </div>
            </div>
        );
    });

    // ── active filter chips (breadcrumb; shown in the main header only when set) ─
    const filterChips = combine([ctrl.query], () => {
        const q = ctrl.query.getValue();
        const active: TExoSchema[] = [];
        if (q.status)
            active.push(
                chip(`status: ${q.status}`, null, true, () =>
                    ctrl.setQuery({ status: undefined })
                )
            );
        if (q.entryCollateralName)
            active.push(
                chip(`type: ${q.entryCollateralName}`, null, true, () =>
                    ctrl.setQuery({ entryCollateralName: undefined })
                )
            );
        if (q.neuronName)
            active.push(
                chip(`neuron: ${q.neuronName}`, null, true, () =>
                    ctrl.setQuery({ neuronName: undefined })
                )
            );
        if (q.text)
            active.push(
                chip(`"${q.text}"`, null, true, () =>
                    ctrl.setQuery({ text: undefined })
                )
            );
        if (!active.length) return <div static={{ style: 'display:none' }} />;
        return (
            <div static={{ style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border-primary)' }}>
                <span static={{ style: 'font-size:10px;letter-spacing:1px;color:var(--text-muted);text-transform:uppercase' }}>Filters</span>
                {active}
            </div>
        );
    });

    // ── run count (top bar; prominent bright yellow) ─────────────────────────
    const runsCount = combine([ctrl.total], () => (
        <span static={{ style: 'font-size:13px;color:var(--infection-yellow);white-space:nowrap;font-weight:600' }}>
            {String(ctrl.total.getValue())} runs
        </span>
    ));

    // ── windowed runs list ───────────────────────────────────────────────────
    const rowView = (r: TCNSStimulationRowDTO, top: number): TExoSchema => {
        const color =
            r.status === 'failed'
                ? 'var(--infection-red)'
                : r.status === 'completed'
                  ? 'var(--infection-green)'
                  : 'var(--infection-yellow)';
        return (
            <div
                static={{
                    class: 'exp-row',
                    style:
                        `position:absolute;top:${top}px;left:0;right:0;height:${ROW_H}px;` +
                        'display:flex;align-items:center;gap:10px;padding:0 10px;' +
                        'border-bottom:1px solid var(--border-primary);cursor:pointer;font-size:12px',
                }}
                handlers={{ onClick: () => void ctrl.selectRun(r.stimulationId) }}
            >
                <span static={{ style: `width:8px;height:8px;border-radius:50%;background:${color};flex:none` }} />
                <span static={{ style: 'color:var(--text-accent);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1' }}>{r.entry.collateralName}</span>
                <span static={{ style: 'color:var(--text-muted);white-space:nowrap' }}>{fmtTime(r.startedAt)}</span>
                <span static={{ style: 'color:var(--text-muted);white-space:nowrap' }}>{String(r.hopCount)} hops</span>
                <span static={{ style: `color:${color};text-transform:uppercase;font-size:10px;white-space:nowrap` }}>{r.status}</span>
            </div>
        );
    };

    const runsList = combine([ctrl.rows, scrollTop, viewportH, ctrl.hasMore], () => {
        const all = ctrl.rows.getValue();
        const st = scrollTop.getValue();
        const vh = viewportH.getValue();
        const first = Math.max(0, Math.floor(st / ROW_H) - OVERSCAN);
        const last = Math.min(
            all.length,
            Math.ceil((st + vh) / ROW_H) + OVERSCAN
        );
        const windowRows = all.slice(first, last).map((r, i) => rowView(r, (first + i) * ROW_H));
        return (
            <div
                static={{
                    style: 'flex:1;position:relative;overflow:auto',
                    onExoMount: (n: { element: unknown }) => {
                        const el = n.element as HTMLElement;
                        viewportH.setValue(el.clientHeight || 600);
                    },
                }}
                handlers={{
                    onScroll: (e: Event) => {
                        const el = e.target as HTMLElement;
                        scrollTop.setValue(el.scrollTop);
                        // infinite scroll: near the bottom → load the next page
                        if (
                            ctrl.hasMore.getValue() &&
                            el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 8
                        )
                            void ctrl.loadMore();
                    },
                }}
            >
                {/* full-height spacer so the scrollbar reflects the whole list */}
                <div static={{ style: `height:${all.length * ROW_H}px;position:relative` }}>
                    {windowRows}
                </div>
            </div>
        );
    });

    // ── waterfall (from detail buckets, joined by attempt id on the client) ──
    const actionBtn = (
        text: string,
        run: string,
        fn: (id: string) => Promise<void>
    ): TExoSchema => (
        <button
            static={{
                style:
                    'padding:3px 12px;font-size:11px;text-transform:uppercase;letter-spacing:1px;cursor:pointer;' +
                    'border:1px solid var(--border-primary);background:var(--bg-card);color:var(--text-secondary)',
            }}
            handlers={{ onClick: () => void fn(run) }}
        >
            {text}
        </button>
    );
    const waterfall = combine(
        [ctrl.detail, ctrl.query, ctrl.actionError, ctrl.actionNotice],
        () => {
            const d = ctrl.detail.getValue();
            const q = ctrl.query.getValue();
            const err = ctrl.actionError.getValue();
            const notice = ctrl.actionNotice.getValue();
            if (!q.selected)
                return <div static={{ style: 'padding:16px;color:var(--text-muted);font-size:12px' }}>Select a run to see its waterfall.</div>;
            if (!d)
                return <div static={{ style: 'padding:16px;color:var(--text-muted);font-size:12px' }}>Loading…</div>;
            const run = q.selected;
            // Retry resumes a FAILED run's unfinished branch. A completed run has no
            // frontier — Retry is disabled there; Clone (fresh run from entry) is the
            // action instead.
            const last = d.attempts[d.attempts.length - 1];
            const retryable = !!last && (last.status === 'failed' || last.hasError);
            const retryBtn = (
                <button
                    static={{
                        title: retryable
                            ? 'Resume this run’s failed step (only the unfinished branch re-runs)'
                            : 'This run finished — nothing to resume. Use Clone to run it again.',
                        style:
                            'padding:3px 12px;font-size:11px;text-transform:uppercase;letter-spacing:1px;' +
                            'border:1px solid var(--border-primary);' +
                            (retryable
                                ? 'cursor:pointer;background:var(--bg-card);color:var(--infection-green);border-color:var(--infection-green)'
                                : 'cursor:not-allowed;background:var(--bg-secondary);color:var(--text-muted);opacity:.5'),
                    }}
                    handlers={{ onClick: () => retryable && void ctrl.retryRun(run) }}
                >
                    Retry
                </button>
            );
            // Visible acknowledgement of Retry/Clone: a green success toast (auto-
            // clears) or a red error line — the owner must always see the outcome.
            const feedback = notice ? (
                <div static={{ class: 'exp-toast', style: 'padding:6px 10px;font-size:12px;color:var(--bg-primary);background:var(--infection-green);border-radius:2px;word-break:break-all' }}>
                    ✓ {notice}
                </div>
            ) : err ? (
                <div static={{ class: 'exp-toast', style: 'padding:6px 10px;font-size:12px;color:var(--bg-primary);background:var(--infection-red);border-radius:2px;word-break:break-all' }}>
                    ✕ {err}
                </div>
            ) : (
                <div />
            );
            return (
                <div static={{ style: 'display:flex;flex-direction:column;gap:10px;padding:12px;overflow:auto' }}>
                    <div static={{ style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }}>
                        <div static={{ style: 'color:var(--text-accent);font-size:13px;word-break:break-all;flex:1;min-width:0' }}>{run}</div>
                        {retryBtn}
                        {actionBtn('Clone', run, ctrl.cloneRun)}
                    </div>
                    {feedback}
                    {!retryable && !notice && !err ? (
                        <div static={{ style: 'color:var(--text-muted);font-size:11px' }}>
                            This run finished — nothing to resume. <b static={{ style: 'color:var(--infection-green)' }}>Clone</b> runs it again from the start.
                        </div>
                    ) : (
                        <div />
                    )}
                    {d.attempts.map(a => (
                        <div static={{ style: 'border:1px solid var(--border-primary);background:var(--bg-card)' }}>
                            <div static={{ style: 'padding:6px 10px;background:var(--bg-secondary);font-size:11px;color:var(--infection-yellow);text-transform:uppercase;letter-spacing:1px' }}>Attempt #{String(a.attemptNumber)} · {a.status} · {String(a.hopCount)} hops</div>
                            {d.tasks
                                .filter(t => t.stimulationAttemptId === a.stimulationAttemptId)
                                .map(t => (
                                    <div static={{ style: `padding:6px 10px;font-size:12px;border-top:1px solid var(--border-primary);box-shadow:${t.error ? 'inset 3px 0 0 var(--infection-red)' : 'none'}` }}>
                                        <span static={{ style: 'color:var(--infection-purple)' }}>{t.neuronName}</span>
                                        <span static={{ style: 'color:var(--text-muted)' }}> {t.dendriteCollateralName} → {t.output?.collateralName ?? 'no output'}</span>
                                        {t.error ? <div static={{ style: 'color:var(--infection-red);font-size:11px' }}>{t.error}</div> : <div />}
                                    </div>
                                ))}
                        </div>
                    ))}
                </div>
            );
        }
    );

    // ── chart view (legible throughput histogram; div-based bars, no SVG) ─────
    // Y = run count (stacked completed/failed/running) or, when a metric path is
    // set, the summed payload metric per time-bucket. Legend, gridlines, a peak
    // y-label, thin centred bars + hover tooltips → readable, not ambiguous slabs.
    const chartMode = bindable<'count' | 'metric'>('count');
    const seg = (h: number, color: string, title: string): TExoSchema =>
        h <= 0 ? (
            <div />
        ) : (
            <div
                static={{
                    title,
                    style: `height:${h}%;background:${color};min-height:1px`,
                }}
            />
        );
    const swatch = (color: string, text: string): TExoSchema => (
        <span static={{ style: 'display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-secondary)' }}>
            <span static={{ style: `width:10px;height:10px;border-radius:2px;background:${color};flex:none` }} />
            {text}
        </span>
    );
    const barColumn = (
        b: TCNSStimulationTimeBucket,
        maxCount: number,
        maxMetric: number,
        mode: 'count' | 'metric'
    ): TExoSchema => {
        const t = fmtTime(b.tsBucket);
        const total = b.completed + b.failed + b.running;
        const barTitle =
            mode === 'metric'
                ? `${t} · Σ ${b.metric ?? 0}`
                : `${t} · ${b.completed} completed · ${b.failed} failed · ${b.running} running`;
        const col: TExoSchema[] =
            mode === 'metric'
                ? [
                      seg(
                          maxMetric ? ((b.metric ?? 0) / maxMetric) * 100 : 0,
                          'var(--infection-yellow)',
                          barTitle
                      ),
                  ]
                : [
                      // column-reverse → first child sits at the bottom
                      seg(maxCount ? (b.completed / maxCount) * 100 : 0, 'var(--infection-green)', barTitle),
                      seg(maxCount ? (b.failed / maxCount) * 100 : 0, 'var(--infection-red)', barTitle),
                      seg(maxCount ? (b.running / maxCount) * 100 : 0, 'var(--infection-purple)', barTitle),
                  ];
        return (
            // slot (flex:1) centres a thin bar → small gaps between bars
            <div static={{ title: barTitle, style: 'flex:1 1 0;min-width:3px;display:flex;justify-content:center;align-items:flex-end;height:100%' }}>
                <div static={{ style: `width:64%;max-width:16px;height:100%;display:flex;flex-direction:column-reverse;justify-content:flex-start;opacity:${total || mode === 'metric' ? '1' : '.25'}` }}>
                    {col}
                </div>
            </div>
        );
    };
    const modeToggle = (
        m: ReturnType<typeof bindable<'count' | 'metric'>>
    ): TExoSchema => {
        const btn = (val: 'count' | 'metric', text: string): TExoSchema => (
            <button
                static={{
                    style:
                        'padding:2px 8px;font-size:10px;text-transform:uppercase;cursor:pointer;border:1px solid var(--border-primary);' +
                        (m.getValue() === val
                            ? 'background:var(--infection-purple);color:var(--bg-primary)'
                            : 'background:var(--bg-card);color:var(--text-secondary)'),
                }}
                handlers={{ onClick: () => m.setValue(val) }}
            >
                {text}
            </button>
        );
        return (
            <div static={{ style: 'display:flex;gap:2px' }}>
                {[btn('count', 'Count'), btn('metric', 'Metric')]}
            </div>
        );
    };
    const gridline = (pct: number): TExoSchema => (
        <div static={{ style: `position:absolute;left:0;right:0;bottom:${pct}%;height:1px;background:var(--border-primary);opacity:.5` }} />
    );
    const chartView = combine([ctrl.facets, ctrl.query, chartMode], () => {
        const buckets = ctrl.facets.getValue().byTime;
        const q = ctrl.query.getValue();
        const mode: 'count' | 'metric' =
            q.metricPath && chartMode.getValue() === 'metric'
                ? 'metric'
                : 'count';
        if (!buckets.length)
            return <div static={{ style: 'padding:16px;color:var(--text-muted);font-size:12px' }}>No runs in range.</div>;
        const maxCount = Math.max(
            1,
            ...buckets.map(b => b.completed + b.failed + b.running)
        );
        const maxMetric = Math.max(0, ...buckets.map(b => b.metric ?? 0));
        const yMax = mode === 'metric' ? maxMetric : maxCount;
        const legend =
            mode === 'metric'
                ? [swatch('var(--infection-yellow)', `Σ ${q.metricPath}`)]
                : [
                      swatch('var(--infection-green)', 'completed'),
                      swatch('var(--infection-red)', 'failed'),
                      swatch('var(--infection-purple)', 'running'),
                  ];
        return (
            <div static={{ style: 'flex:1;display:flex;flex-direction:column;padding:12px;gap:8px;min-height:0' }}>
                <div static={{ style: 'display:flex;align-items:baseline;gap:10px;flex-wrap:wrap' }}>
                    <h3 static={{ class: 'exp-heading', style: 'margin:0;font-size:13px;letter-spacing:1px;color:var(--text-primary);text-transform:uppercase' }}>Throughput</h3>
                    <span static={{ style: 'font-size:11px;color:var(--text-muted)' }}>{mode === 'metric' ? `Σ ${q.metricPath} per bucket` : 'runs per bucket'} · peak {String(yMax)}</span>
                    {q.metricPath
                        ? modeToggle(chartMode)
                        : <span static={{ style: 'font-size:10px;color:var(--text-muted)' }}>set a metric path (top bar) to sum a payload field</span>}
                </div>
                <div static={{ style: 'display:flex;gap:14px;flex-wrap:wrap' }}>{legend}</div>
                <div static={{ style: 'flex:1;display:flex;min-height:160px;gap:8px' }}>
                    {/* y-axis scale (max at top, 0 at bottom) */}
                    <div static={{ style: 'display:flex;flex-direction:column;justify-content:space-between;font-size:9px;color:var(--text-muted);text-align:right;min-width:22px' }}>
                        <span>{String(yMax)}</span>
                        <span>0</span>
                    </div>
                    {/* plot: faint gridlines behind, thin bars in front */}
                    <div static={{ style: 'flex:1;position:relative;border-left:1px solid var(--border-primary);border-bottom:1px solid var(--border-primary)' }}>
                        {[gridline(25), gridline(50), gridline(75), gridline(100)]}
                        <div static={{ style: 'position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px;padding:0 2px' }}>
                            {buckets.map(b => barColumn(b, maxCount, maxMetric, mode))}
                        </div>
                    </div>
                </div>
                <div static={{ style: 'display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);padding-left:30px' }}>
                    <span>{fmtTime(buckets[0].tsBucket)}</span>
                    <span>{fmtTime(buckets[buckets.length - 1].tsBucket)}</span>
                </div>
            </div>
        );
    });

    // ── search box (uncontrolled; debounced on input) ────────────────────────
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const searchBox: TExoSchema = (
        <input
            static={{
                placeholder: 'search stimulationId…',
                style:
                    'width:200px;padding:5px 8px;font-size:12px;background:var(--bg-secondary);' +
                    'border:1px solid var(--border-primary);color:var(--text-primary);border-radius:2px',
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

    // ── view-switch (Runs ⇄ Waterfall ⇄ Chart) ───────────────────────────────
    const paneFor = (view: string): TExoSchema => {
        if (view === 'waterfall')
            return <div static={{ style: 'flex:1;display:flex;min-height:0' }} bindable={{ children: waterfall }} />;
        if (view === 'chart')
            return <div static={{ style: 'flex:1;display:flex;min-height:0;overflow:auto' }} bindable={{ children: chartView }} />;
        return <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0' }} bindable={{ children: runsList }} />;
    };
    const resultPane = combine([ctrl.query], () =>
        paneFor(ctrl.query.getValue().view)
    );
    // Active tab accent = bright yellow (owner ask); inactive = muted card.
    const viewBtn = (
        v: 'runs' | 'waterfall' | 'chart',
        label: string,
        active: boolean
    ): TExoSchema => (
        <button
            static={{
                style:
                    `padding:4px 12px;font-size:11px;cursor:pointer;` +
                    `text-transform:uppercase;letter-spacing:1px;` +
                    (active
                        ? 'background:var(--infection-yellow);color:var(--bg-primary);border:1px solid var(--infection-yellow);font-weight:600'
                        : 'background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border-primary)'),
            }}
            handlers={{ onClick: () => ctrl.setQuery({ view: v }) }}
        >
            {label}
        </button>
    );
    const viewSwitch = combine([ctrl.query], () => {
        const v = ctrl.query.getValue().view;
        return (
            <div static={{ style: 'display:flex;gap:2px' }}>
                {[
                    viewBtn('runs', 'Runs', v === 'runs'),
                    viewBtn('waterfall', 'Waterfall', v === 'waterfall'),
                    viewBtn('chart', 'Chart', v === 'chart'),
                ]}
            </div>
        );
    });

    // Metric-path input (chart only; stable element so a live facets refresh never
    // yanks focus while typing). Shown in the top bar only when the Chart view is
    // active — it is meaningless elsewhere.
    let metricDebounce: ReturnType<typeof setTimeout> | null = null;
    const metricInput: TExoSchema = (
        <input
            static={{
                placeholder: 'chart metric: payload path (e.g. pages)',
                value: ctrl.query.getValue().metricPath ?? '',
                style:
                    'width:220px;padding:5px 8px;font-size:12px;background:var(--bg-secondary);' +
                    'border:1px solid var(--border-primary);color:var(--text-primary);border-radius:2px',
            }}
            handlers={{
                onInput: (e: Event) => {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (metricDebounce) clearTimeout(metricDebounce);
                    metricDebounce = setTimeout(() => {
                        ctrl.setQuery({ metricPath: v || undefined });
                        if (v) chartMode.setValue('metric');
                    }, 300);
                },
            }}
        />
    );
    const metricSlot = combine([ctrl.query], () =>
        ctrl.query.getValue().view === 'chart' ? metricInput : <div />
    );

    return (
        <div
            static={{
                style: 'display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden;background:var(--bg-primary)',
                onExoMount: () => ctrl.start(),
                onExoUnmount: () => ctrl.stop(),
            }}
        >
            {/* ── ONE top bar: identity/health · search · tabs · metric · beat · count ── */}
            <div static={{ style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--border-primary);background:var(--bg-panel)' }}>
                <div bindable={{ children: connBlock }} />
                <div static={{ style: 'width:1px;height:20px;background:var(--border-primary)' }} />
                {searchBox}
                <div bindable={{ children: viewSwitch }} />
                <div bindable={{ children: metricSlot }} />
                <div static={{ style: 'flex:1' }} />
                {heartbeatMonitor(ctrl.total)}
                <div bindable={{ children: runsCount }} />
            </div>
            {/* ── body: compact facet rail (only secondary column) + main area ── */}
            <div static={{ style: 'flex:1;display:flex;min-height:0;overflow:hidden' }}>
                <div static={{ style: 'width:200px;flex:none;border-right:1px solid var(--border-primary);padding:12px;overflow:auto;background:var(--bg-panel)' }} bindable={{ children: facetRail }} />
                <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-width:0' }}>
                    <div bindable={{ children: filterChips }} />
                    <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0' }} bindable={{ children: resultPane }} />
                </div>
            </div>
        </div>
    );
}
