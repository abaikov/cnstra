import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import { fmtTime } from '../utils/format';
import type { TCNSExplorerController } from './explorerController';
import { toggleFilter } from './queryState';
import type {
    TCNSStimulationRowDTO,
    TCNSStimulationTimeBucket,
} from '@cnstra/devtools-dto';
import { heartbeatMonitor } from './HeartbeatMonitor';

// The faceted explorer (slice 3 core): one query-state → a facet rail (counts),
// removable filter chips, a search box, a WINDOWED runs list (only visible rows are
// in the DOM — usable at 20k), and a waterfall built from the detail buckets. All
// state lives in the controller; this view only reads bindables + dispatches patches.

const ROW_H = 44; // px, fixed → enables windowing
const OVERSCAN = 6;

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

export function explorerPage(ctrl: TCNSExplorerController): TExoSchema {
    // Scroll offset drives the window; a ResizeObserver-free height guess is fine
    // (the container is a fixed flex child).
    const scrollTop = bindable(0);
    const viewportH = bindable(600);

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
    const label = (t: string): TExoSchema => (
        <div static={{ style: 'font-size:10px;letter-spacing:1.5px;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px' }}>{t}</div>
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
                    {label(neurons ? 'Neuron' : 'Entry collateral (job type)')}
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

    // ── active filter chips (breadcrumb) ─────────────────────────────────────
    const filterChips = combine([ctrl.query, ctrl.total], () => {
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
        return (
            <div static={{ style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px;color:var(--text-muted)' }}>
                <span>{String(ctrl.total.getValue())} runs</span>
                {active}
            </div>
        );
    });

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
    const waterfall = combine([ctrl.detail, ctrl.query, ctrl.actionError], () => {
        const d = ctrl.detail.getValue();
        const q = ctrl.query.getValue();
        const err = ctrl.actionError.getValue();
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
        return (
            <div static={{ style: 'display:flex;flex-direction:column;gap:10px;padding:12px;overflow:auto' }}>
                <div static={{ style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }}>
                    <div static={{ style: 'color:var(--text-accent);font-size:13px;word-break:break-all;flex:1;min-width:0' }}>{run}</div>
                    {retryBtn}
                    {actionBtn('Clone', run, ctrl.cloneRun)}
                </div>
                {!retryable && !err ? (
                    <div static={{ style: 'color:var(--text-muted);font-size:11px' }}>
                        This run finished — nothing to resume. <b static={{ style: 'color:var(--infection-green)' }}>Clone</b> runs it again from the start.
                    </div>
                ) : (
                    <div />
                )}
                {err ? <div static={{ style: 'color:var(--infection-red);font-size:11px' }}>{err}</div> : <div />}
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
    });

    // ── chart view (throughput histogram; div-based bars, no SVG namespace) ──
    // Y = run count (stacked completed/failed/running) or, when a metric path is
    // set, the summed payload metric per time-bucket.
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
    const barColumn = (
        b: TCNSStimulationTimeBucket,
        maxCount: number,
        maxMetric: number,
        mode: 'count' | 'metric'
    ): TExoSchema => {
        const t = fmtTime(b.tsBucket);
        const col: TExoSchema[] =
            mode === 'metric'
                ? [
                      seg(
                          maxMetric ? ((b.metric ?? 0) / maxMetric) * 100 : 0,
                          'var(--infection-yellow)',
                          `${t} · ${b.metric ?? 0}`
                      ),
                  ]
                : [
                      // column-reverse → first child sits at the bottom
                      seg(
                          maxCount ? (b.completed / maxCount) * 100 : 0,
                          'var(--infection-green)',
                          `${t} · ${b.completed} completed`
                      ),
                      seg(
                          maxCount ? (b.failed / maxCount) * 100 : 0,
                          'var(--infection-red)',
                          `${t} · ${b.failed} failed`
                      ),
                      seg(
                          maxCount ? (b.running / maxCount) * 100 : 0,
                          'var(--infection-purple)',
                          `${t} · ${b.running} running`
                      ),
                  ];
        return (
            <div static={{ style: 'flex:1;min-width:2px;display:flex;flex-direction:column-reverse;justify-content:flex-start' }}>
                {col}
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
        return (
            <div static={{ style: 'flex:1;display:flex;flex-direction:column;padding:12px;gap:8px;min-height:0' }}>
                <div static={{ style: 'display:flex;align-items:center;gap:10px;font-size:11px;color:var(--text-muted)' }}>
                    <span>{mode === 'metric' ? `Σ ${q.metricPath} per bucket` : 'runs per bucket'} · peak {String(yMax)}</span>
                    {q.metricPath
                        ? modeToggle(chartMode)
                        : <span static={{ style: 'color:var(--text-muted)' }}>set a metric path below to sum a payload field</span>}
                </div>
                <div static={{ style: 'flex:1;display:flex;align-items:stretch;gap:1px;min-height:120px;border-bottom:1px solid var(--border-primary);border-left:1px solid var(--border-primary);padding:2px' }}>
                    {buckets.map(b => barColumn(b, maxCount, maxMetric, mode))}
                </div>
                <div static={{ style: 'display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted)' }}>
                    <span>{fmtTime(buckets[0].tsBucket)}</span>
                    <span>{fmtTime(buckets[buckets.length - 1].tsBucket)}</span>
                </div>
            </div>
        );
    });

    // ── map view (proportional activation heat-map; lens-aware) ──────────────
    // Tiles for the active lens's dimension (neurons or entry collaterals), each
    // grown + heated by activation count — a weight map of where runs concentrate.
    // Click a tile to filter, same as a facet chip.
    const mapView = combine([ctrl.facets, ctrl.query], () => {
        const f = ctrl.facets.getValue();
        const q = ctrl.query.getValue();
        const neurons = q.lens === 'neurons';
        const dim = neurons ? f.byNeuron : f.byEntryCollateral;
        if (!dim.length)
            return <div static={{ style: 'padding:16px;color:var(--text-muted);font-size:12px' }}>No activation to map.</div>;
        const max = Math.max(...dim.map(d => d.count));
        const selected = neurons ? q.neuronName : q.entryCollateralName;
        return (
            <div static={{ style: 'flex:1;display:flex;flex-direction:column;gap:8px;padding:12px;min-height:0;overflow:auto' }}>
                <div static={{ style: 'font-size:11px;color:var(--text-muted)' }}>{neurons ? 'neuron' : 'entry collateral'} activation · tile size + heat ∝ run count</div>
                <div static={{ style: 'display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start' }}>
                    {dim.map(d => {
                        const intensity = max ? d.count / max : 0;
                        const pct = Math.round(20 + intensity * 80); // 20..100%
                        const isSel = selected === d.name;
                        return (
                            <div
                                static={{
                                    title: `${d.name} · ${d.count}`,
                                    style:
                                        `flex:${1 + Math.round(intensity * 6)} 1 90px;` +
                                        `min-width:90px;padding:8px 10px;cursor:pointer;` +
                                        `border:1px solid ${isSel ? 'var(--infection-yellow)' : 'var(--border-primary)'};` +
                                        `background:color-mix(in srgb, var(--infection-purple) ${pct}%, var(--bg-card));` +
                                        `color:${intensity > 0.5 ? 'var(--bg-primary)' : 'var(--text-primary)'};` +
                                        'display:flex;flex-direction:column;gap:2px;overflow:hidden',
                                }}
                                handlers={{
                                    onClick: () =>
                                        ctrl.setQuery(
                                            toggleFilter(
                                                q,
                                                neurons
                                                    ? 'neuronName'
                                                    : 'entryCollateralName',
                                                d.name
                                            )
                                        ),
                                }}
                            >
                                <span static={{ style: 'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }}>{d.name}</span>
                                <span static={{ style: 'font-size:16px;font-weight:600;font-variant-numeric:tabular-nums' }}>{String(d.count)}</span>
                            </div>
                        );
                    })}
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
                    'width:220px;padding:5px 8px;font-size:12px;background:var(--bg-secondary);' +
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
        if (view === 'map')
            return <div static={{ style: 'flex:1;display:flex;min-height:0;overflow:auto' }} bindable={{ children: mapView }} />;
        return <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0' }} bindable={{ children: runsList }} />;
    };
    const resultPane = combine([ctrl.query], () =>
        paneFor(ctrl.query.getValue().view)
    );
    const viewBtn = (
        v: 'runs' | 'waterfall' | 'chart' | 'map',
        label: string,
        active: boolean
    ): TExoSchema => (
        <button
            static={{
                style:
                    `padding:4px 10px;font-size:11px;cursor:pointer;border:1px solid var(--border-primary);` +
                    `text-transform:uppercase;letter-spacing:1px;` +
                    (active
                        ? 'background:var(--infection-purple);color:var(--bg-primary)'
                        : 'background:var(--bg-card);color:var(--text-secondary)'),
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
                    viewBtn('map', 'Map', v === 'map'),
                ]}
            </div>
        );
    });

    // Metric-path input (chart board). Stable element (like searchBox) so a live
    // facets refresh never yanks focus while typing.
    let metricDebounce: ReturnType<typeof setTimeout> | null = null;
    const metricInput: TExoSchema = (
        <input
            static={{
                placeholder: 'chart metric: payload path (e.g. pages)',
                value: ctrl.query.getValue().metricPath ?? '',
                style:
                    'width:200px;padding:5px 8px;font-size:12px;background:var(--bg-secondary);' +
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

    return (
        <div
            static={{
                class: 'no-smooth',
                style: 'display:flex;flex:1;min-height:0;overflow:hidden;background:var(--bg-primary)',
                onExoMount: () => ctrl.start(),
                onExoUnmount: () => ctrl.stop(),
            }}
        >
            <div static={{ style: 'width:240px;flex:none;border-right:1px solid var(--border-primary);padding:12px;overflow:auto' }} bindable={{ children: facetRail }} />
            <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-width:0' }}>
                <div static={{ style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border-primary)' }}>
                    {searchBox}
                    <div bindable={{ children: viewSwitch }} />
                    {metricInput}
                    <div bindable={{ children: filterChips }} />
                    <div static={{ style: 'flex:1' }} />
                    {heartbeatMonitor(ctrl.total)}
                </div>
                <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0' }} bindable={{ children: resultPane }} />
            </div>
        </div>
    );
}
