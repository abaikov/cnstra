import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoWritableBindable } from '@exodra/reactivity';
import type {
    TCNSStimulationFacetsDTO,
    TCNSStimulationTimeBucket,
} from '@cnstra/devtools-dto';
import { fmtAxis, fmtStamp } from '../utils/format';
import { exoCombine } from '@oimdb/exodra';
import { C, livePill } from './parts';

// The GRAPHS zone: a real, filter-scoped THROUGHPUT chart (a separate green
// COMPLETED trace + a red FAILED trace, gridlines, time-axis markers, and chart
// tools — a trace toggle + a window selector) plus the ECG "signal pulse" that
// fires one beat per new stimulation. Both are drawn with namespaced <svg> in
// onExoMount (Exodra JSX doesn't own the SVG namespace; canvas is stripped by
// some sandboxes). Reused-singleton safe. Respects prefers-reduced-motion.

const SVGNS = 'http://www.w3.org/2000/svg';
const el2 = (tag: string): SVGElement =>
    document.createElementNS(SVGNS, tag) as SVGElement;

type TMode = 'both' | 'completed' | 'failed';

// ── ECG maths (unchanged pulse feel) ──
const ECG_W = 200;
const BEAT_LEN = 46;
const g = (p: number, c: number, w: number, a: number): number =>
    a * Math.exp(-((p - c) ** 2) / (2 * w * w));
const pqrst = (p: number): number =>
    g(p, 0.16, 0.026, 0.16) +
    g(p, 0.32, 0.01, -0.12) +
    g(p, 0.35, 0.009, 1.0) +
    g(p, 0.385, 0.011, -0.32) +
    g(p, 0.6, 0.055, 0.3);

// ── THROUGHPUT chart ──────────────────────────────────────────────────────────
// Reads the FILTER-SCOPED `facets.byTime` directly (the Filters "Time range"
// scopes it — there is no chart-local window control). A COMPLETED (green) + a
// FAILED (red) trace, gridlines, and a HOVER tooltip: mousemove snaps to the
// nearest bucket and shows `time · completed N · failed N` with a vertical guide +
// highlighted dots on each visible trace.
function throughputChart(
    facets: TExoWritableBindable<TCNSStimulationFacetsDTO, TCNSStimulationFacetsDTO>,
    mode: TExoWritableBindable<TMode, TMode>,
    onBrush: (since: number, until: number) => void
): TExoSchema {
    const CHART_H = 96;
    const VW = 300;
    return (
        <div
            static={{
                class: 'exp-chart',
                style: `position:relative;width:100%;height:${CHART_H}px`,
                onExoMount: (n: { element: unknown }) => {
                    const host = n.element as HTMLElement;
                    const svg = el2('svg');
                    svg.setAttribute('viewBox', `0 0 ${VW} ${CHART_H}`);
                    svg.setAttribute('preserveAspectRatio', 'none');
                    (svg as SVGSVGElement).style.cssText =
                        `width:100%;height:${CHART_H}px;display:block`;

                    for (const p of [0.25, 0.5, 0.75]) {
                        const ln = el2('line');
                        ln.setAttribute('x1', '0');
                        ln.setAttribute('x2', String(VW));
                        ln.setAttribute('y1', String(CHART_H * p));
                        ln.setAttribute('y2', String(CHART_H * p));
                        ln.setAttribute('stroke', 'var(--border-primary)');
                        ln.setAttribute('stroke-width', '0.5');
                        ln.setAttribute('opacity', '0.5');
                        svg.appendChild(ln);
                    }

                    const mkSeries = (color: string): {
                        area: SVGElement;
                        line: SVGElement;
                    } => {
                        const area = el2('polygon');
                        area.setAttribute('fill', color);
                        area.setAttribute('opacity', '0.14');
                        const line = el2('polyline');
                        line.setAttribute('fill', 'none');
                        line.setAttribute('stroke', color);
                        line.setAttribute('stroke-width', '1.6');
                        (line as SVGElement).style.filter = `drop-shadow(0 0 2px ${color})`;
                        svg.appendChild(area);
                        svg.appendChild(line);
                        return { area, line };
                    };
                    const completed = mkSeries(C.green);
                    const failed = mkSeries(C.red);

                    // hover overlay: vertical guide + a dot per visible trace
                    const guide = el2('line');
                    guide.setAttribute('stroke', 'var(--infection-pink)');
                    guide.setAttribute('stroke-width', '1');
                    guide.setAttribute('stroke-dasharray', '2 3');
                    guide.setAttribute('opacity', '0');
                    guide.setAttribute('y1', '0');
                    guide.setAttribute('y2', String(CHART_H));
                    const dotC = el2('circle');
                    dotC.setAttribute('r', '3');
                    dotC.setAttribute('fill', C.green);
                    dotC.setAttribute('opacity', '0');
                    const dotF = el2('circle');
                    dotF.setAttribute('r', '3');
                    dotF.setAttribute('fill', C.red);
                    dotF.setAttribute('opacity', '0');
                    // brush selection rectangle (drag to pick a time range)
                    const sel = el2('rect');
                    sel.setAttribute('y', '0');
                    sel.setAttribute('height', String(CHART_H));
                    sel.setAttribute('fill', 'var(--infection-pink)');
                    sel.setAttribute('opacity', '0');
                    sel.setAttribute('pointer-events', 'none');
                    svg.appendChild(guide);
                    svg.appendChild(dotC);
                    svg.appendChild(dotF);
                    svg.appendChild(sel);
                    host.appendChild(svg);

                    const peakText = document.createElement('span');
                    peakText.style.cssText =
                        'position:absolute;left:4px;top:2px;font-size:9px;color:var(--text-muted);pointer-events:none';
                    host.appendChild(peakText);

                    const tip = document.createElement('div');
                    tip.className = 'exp-chart-tip';
                    tip.style.cssText =
                        'position:absolute;z-index:5;pointer-events:none;display:none;padding:4px 8px;' +
                        'font-size:10px;white-space:nowrap;border-radius:4px;background:var(--bg-card);' +
                        'border:1px solid var(--border-accent);color:var(--text-primary);box-shadow:0 6px 18px rgba(0,0,0,.5)';
                    host.appendChild(tip);

                    // draw state shared with the hover handler
                    let buckets: TCNSStimulationTimeBucket[] = [];
                    let curMax = 1;
                    const xAt = (i: number): number =>
                        buckets.length <= 1 ? VW / 2 : (i / (buckets.length - 1)) * VW;
                    const yAt = (v: number): number =>
                        CHART_H - 2 - (v / curMax) * (CHART_H - 6);

                    const draw = (): void => {
                        buckets = facets.getValue().byTime;
                        const m = mode.getValue();
                        const show = {
                            completed: m === 'both' || m === 'completed',
                            failed: m === 'both' || m === 'failed',
                        };
                        curMax = Math.max(
                            1,
                            ...buckets.map(b =>
                                Math.max(show.completed ? b.completed : 0, show.failed ? b.failed : 0)
                            )
                        );
                        const n = buckets.length;
                        const plot = (
                            s: { area: SVGElement; line: SVGElement },
                            pick: (b: TCNSStimulationTimeBucket) => number,
                            visible: boolean
                        ): void => {
                            if (!visible || !n) {
                                s.line.setAttribute('points', '');
                                s.area.setAttribute('points', '');
                                return;
                            }
                            let pts = '';
                            for (let i = 0; i < n; i++)
                                pts += `${xAt(i).toFixed(1)},${yAt(pick(buckets[i])).toFixed(1)} `;
                            s.line.setAttribute('points', pts.trim());
                            s.area.setAttribute('points', `0,${CHART_H} ${pts} ${VW},${CHART_H}`);
                        };
                        plot(completed, b => b.completed, show.completed);
                        plot(failed, b => b.failed, show.failed);
                        peakText.textContent = `peak ${curMax}`;
                    };

                    const hideHover = (): void => {
                        guide.setAttribute('opacity', '0');
                        dotC.setAttribute('opacity', '0');
                        dotF.setAttribute('opacity', '0');
                        tip.style.display = 'none';
                    };
                    // ── brush: drag across the chart to SET the time range ──
                    host.style.cursor = 'crosshair';
                    let dragStart: number | null = null; // ratio 0..1 at mousedown
                    const ratioOf = (ev: MouseEvent): number => {
                        const r = host.getBoundingClientRect();
                        return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
                    };
                    const paintSel = (a: number, b: number): void => {
                        const lo = Math.min(a, b);
                        const hi = Math.max(a, b);
                        sel.setAttribute('x', String(lo * VW));
                        sel.setAttribute('width', String((hi - lo) * VW));
                        sel.setAttribute('opacity', '0.18');
                    };
                    host.addEventListener('mousedown', (ev: MouseEvent) => {
                        if (!buckets.length) return;
                        dragStart = ratioOf(ev);
                        paintSel(dragStart, dragStart);
                        hideHover();
                        ev.preventDefault();
                    });
                    const endDrag = (ev: MouseEvent): void => {
                        if (dragStart == null) return;
                        const start = dragStart;
                        dragStart = null;
                        sel.setAttribute('opacity', '0');
                        const n = buckets.length;
                        const end = ratioOf(ev);
                        // a tiny drag is really a click — don't hijack it into a range
                        if (n < 2 || Math.abs(end - start) < 0.02) return;
                        const lo = Math.min(start, end);
                        const hi = Math.max(start, end);
                        const iLo = Math.round(lo * (n - 1));
                        const iHi = Math.round(hi * (n - 1));
                        const width = buckets[1].tsBucket - buckets[0].tsBucket || 60000;
                        onBrush(buckets[iLo].tsBucket, buckets[iHi].tsBucket + width);
                    };
                    if (typeof window !== 'undefined')
                        window.addEventListener('mouseup', endDrag);
                    host.addEventListener('mousemove', (ev: MouseEvent) => {
                        const n = buckets.length;
                        if (!n) return hideHover();
                        if (dragStart != null) {
                            paintSel(dragStart, ratioOf(ev));
                            return;
                        }
                        const rect = host.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                        const i = Math.round(ratio * (n - 1));
                        const b = buckets[i];
                        const m = mode.getValue();
                        const showC = m === 'both' || m === 'completed';
                        const showF = m === 'both' || m === 'failed';
                        const gx = xAt(i);
                        guide.setAttribute('x1', String(gx));
                        guide.setAttribute('x2', String(gx));
                        guide.setAttribute('opacity', '0.8');
                        dotC.setAttribute('cx', String(gx));
                        dotC.setAttribute('cy', String(yAt(b.completed)));
                        dotC.setAttribute('opacity', showC ? '1' : '0');
                        dotF.setAttribute('cx', String(gx));
                        dotF.setAttribute('cy', String(yAt(b.failed)));
                        dotF.setAttribute('opacity', showF ? '1' : '0');
                        tip.innerHTML =
                            `<span style="color:var(--text-muted)">${fmtStamp(b.tsBucket)}</span>` +
                            ` · <span style="color:${C.green}">completed ${b.completed}</span>` +
                            ` · <span style="color:${C.red}">failed ${b.failed}</span>`;
                        tip.style.display = 'block';
                        const tw = tip.offsetWidth || 140;
                        let left = ev.clientX - rect.left + 10;
                        if (left + tw > rect.width) left = rect.width - tw - 4;
                        tip.style.left = `${Math.max(0, left)}px`;
                        tip.style.top = '2px';
                    });
                    host.addEventListener('mouseleave', () => {
                        if (dragStart == null) hideHover();
                    });

                    facets.subscribe(draw);
                    mode.subscribe(draw);
                    draw();
                },
            }}
        />
    );
}

// ── ECG signal pulse ────────────────────────────────────────────────────────────
interface TEcgState {
    raf: number;
    unsub: () => void;
}
const ecgMounted = new WeakMap<HTMLElement, TEcgState>();
function startEcg(
    el: HTMLElement,
    activity: TExoWritableBindable<number, number>
): void {
    if (ecgMounted.has(el)) return;
    const reduced =
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ecgH = 30;
    const svg = el2('svg');
    svg.setAttribute('viewBox', `0 0 ${ECG_W} ${ecgH}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    (svg as SVGSVGElement).style.cssText = 'width:100%;height:30px;display:block';
    (svg as SVGElement).style.filter = `drop-shadow(0 0 3px ${C.green})`;
    const line = el2('polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', C.green);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    const head = el2('circle');
    head.setAttribute('r', '2.4');
    head.setAttribute('fill', '#eafbc7');
    svg.appendChild(line);
    svg.appendChild(head);
    el.appendChild(svg);

    const y = new Array(ECG_W).fill(ecgH / 2);
    const queue: number[] = [];
    let beatI = -1;
    const render = (): void => {
        let p = '';
        for (let i = 0; i < ECG_W; i++) p += i + ',' + y[i].toFixed(1) + ' ';
        line.setAttribute('points', p);
        head.setAttribute('cx', String(ECG_W - 1));
        head.setAttribute('cy', y[ECG_W - 1].toFixed(1));
    };
    const advance = (steps: number): void => {
        for (let s = 0; s < steps; s++) {
            let v: number;
            if (beatI < 0 && queue.length) {
                queue.shift();
                beatI = 0;
            }
            if (beatI >= 0) {
                v = ecgH / 2 - pqrst(beatI / BEAT_LEN) * (ecgH / 2 - 2);
                beatI++;
                if (beatI >= BEAT_LEN) beatI = -1;
            } else {
                v = ecgH / 2 + (Math.random() - 0.5) * 1.2;
            }
            y.shift();
            y.push(v);
        }
    };
    let last = activity.getValue();
    const unsub = activity.subscribe(() => {
        const v = activity.getValue();
        const delta = v - last;
        last = v;
        if (delta > 0) for (let i = 0; i < Math.min(delta, 4); i++) queue.push(1);
    });
    if (reduced) {
        queue.push(1);
        advance(BEAT_LEN + 40);
        render();
        ecgMounted.set(el, { raf: 0, unsub });
        return;
    }
    const loop = (): void => {
        if (el.isConnected) {
            advance(2);
            render();
        }
        const st = ecgMounted.get(el);
        if (st) st.raf = requestAnimationFrame(loop);
    };
    ecgMounted.set(el, { raf: requestAnimationFrame(loop), unsub });
}

// ── the GRAPHS zone component ────────────────────────────────────────────────────
export function vitalsMonitor(
    facets: TExoWritableBindable<TCNSStimulationFacetsDTO, TCNSStimulationFacetsDTO>,
    activity: TExoWritableBindable<number, number>,
    onSelectRange: (since: number, until: number) => void
): TExoSchema {
    const mode = bindable<TMode>('both');

    const modeBtn = (val: TMode, label: string, color: string): TExoSchema => {
        const b = exoCombine(() => {
            const active = mode.getValue() === val;
            return (
                <button
                    static={{
                        style:
                            `padding:2px 8px;font-size:9px;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;border-radius:3px;` +
                            `border:1px solid ${active ? color : 'var(--border-primary)'};` +
                            (active
                                ? `background:${color}22;color:${color}`
                                : 'background:var(--bg-card);color:var(--text-muted)'),
                    }}
                    handlers={{ onClick: () => mode.setValue(val) }}
                >
                    {label}
                </button>
            );
        }, [mode]);
        return <div bindable={{ children: b }} />;
    };
    // time-axis markers (start · mid · end) over the filter-scoped byTime buckets
    const axis = exoCombine(() => {
        const buckets = facets.getValue().byTime;
        if (!buckets.length)
            return <div static={{ style: 'display:flex;justify-content:space-between;font-size:8.5px;color:var(--text-muted)' }}><span>—</span></div>;
        const first = buckets[0].tsBucket;
        const last = buckets[buckets.length - 1].tsBucket;
        const span = Math.max(0, last - first);
        // 5 evenly-spaced markers so a months-long range still reads day-by-day.
        const marks = [0, 0.25, 0.5, 0.75, 1].map(
            r => buckets[Math.round(r * (buckets.length - 1))].tsBucket
        );
        return (
            <div static={{ style: 'display:flex;justify-content:space-between;font-size:8.5px;color:var(--text-muted)' }}>
                {marks.map(ts => (
                    <span>{fmtAxis(ts, span)}</span>
                ))}
            </div>
        );
    }, [facets]);

    return (
        <div
            static={{
                title: 'live throughput chart + new-stimulation pulse',
                style:
                    'flex:1;min-width:280px;display:flex;flex-direction:column;gap:5px;' +
                    'border:1px solid var(--border-primary);border-radius:6px;padding:8px 10px;overflow:hidden;' +
                    'background:' +
                    'repeating-linear-gradient(90deg, rgba(65,143,174,.06) 0 1px, transparent 1px 16px),' +
                    'repeating-linear-gradient(0deg, rgba(65,143,174,.06) 0 1px, transparent 1px 16px),' +
                    'var(--bg-secondary)',
            }}
        >
            {/* toolbar */}
            <div static={{ style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }}>
                <span static={{ class: 'exp-heading', style: `font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${C.yellow}` }}>Throughput</span>
                {livePill()}
                <span static={{ style: 'font-size:8.5px;color:var(--text-muted)' }}>drag to pick range</span>
                <div static={{ style: 'flex:1' }} />
                <div static={{ style: 'display:flex;gap:3px' }}>
                    {[
                        modeBtn('both', 'Both', C.cyan),
                        modeBtn('completed', 'Done', C.green),
                        modeBtn('failed', 'Failed', C.red),
                    ]}
                </div>
            </div>
            {throughputChart(facets, mode, onSelectRange)}
            <div bindable={{ children: axis }} />
            {/* signal pulse (ECG flair) */}
            <div static={{ style: 'display:flex;flex-direction:column;gap:1px' }}>
                <span static={{ style: 'font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted)' }}>Signal pulse</span>
                <div
                    static={{
                        onExoMount: (n: { element: unknown }) =>
                            startEcg(n.element as HTMLElement, activity),
                    }}
                />
            </div>
        </div>
    );
}
