import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import { combine } from '../exo/oimdb-bind';
import { fmtTime } from '../utils/format';
import type { TCNSExplorerController } from './explorerController';
import { toggleFilter } from './queryState';
import type { TCNSStimulationRowDTO } from '@cnstra/devtools-dto';

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
    const waterfall = combine([ctrl.detail, ctrl.query], () => {
        const d = ctrl.detail.getValue();
        const q = ctrl.query.getValue();
        if (!q.selected)
            return <div static={{ style: 'padding:16px;color:var(--text-muted);font-size:12px' }}>Select a run to see its waterfall.</div>;
        if (!d)
            return <div static={{ style: 'padding:16px;color:var(--text-muted);font-size:12px' }}>Loading…</div>;
        return (
            <div static={{ style: 'display:flex;flex-direction:column;gap:10px;padding:12px;overflow:auto' }}>
                <div static={{ style: 'color:var(--text-accent);font-size:13px;word-break:break-all' }}>{q.selected}</div>
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

    // ── view-switch (Runs ⇄ Waterfall; Chart/Map are next) ───────────────────
    const resultPane = combine([ctrl.query], () =>
        ctrl.query.getValue().view === 'waterfall' ? (
            <div
                static={{ style: 'flex:1;display:flex;min-height:0' }}
                bindable={{ children: waterfall }}
            />
        ) : (
            <div
                static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0' }}
                bindable={{ children: runsList }}
            />
        )
    );
    const viewBtn = (
        v: 'runs' | 'waterfall',
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
                ]}
            </div>
        );
    });

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
                    <div bindable={{ children: filterChips }} />
                </div>
                <div static={{ style: 'flex:1;display:flex;flex-direction:column;min-height:0' }} bindable={{ children: resultPane }} />
            </div>
        </div>
    );
}
