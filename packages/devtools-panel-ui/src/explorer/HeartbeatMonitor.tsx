import type { TExoSchema } from '@exodra/core';
import type { TExoWritableBindable } from '@exodra/reactivity';

// A compact ECG heartbeat strip for the Explorer header — the panel's "vital sign".
// Each new stimulation (a rise in the roster `total`) injects one P-Q-R-S-T beat;
// idle → a slow baseline. Strip-chart: newest at the right, scrolling left. Built
// with a namespaced <svg> in onExoMount (Exodra's JSX doesn't own the SVG namespace,
// and this sidesteps canvas — which some sandboxes strip). The pane is a reused
// singleton (onExoMount fires once, onExoUnmount on detach but no re-mount), so the
// RAF loop stays alive and simply skips drawing while detached, resuming on re-attach.

const SVGNS = 'http://www.w3.org/2000/svg';
const W = 150; // samples across the viewBox width
const STEP = 2; // samples advanced per frame
const BEAT_LEN = 46; // samples one PQRST spans
const MID = 15;
const AMP = 11;

const g = (p: number, c: number, w: number, a: number): number =>
    a * Math.exp(-((p - c) ** 2) / (2 * w * w));
// P, Q, R (sharp), S, T — a real ECG morphology, not a sine.
const pqrst = (p: number): number =>
    g(p, 0.16, 0.026, 0.16) +
    g(p, 0.32, 0.01, -0.12) +
    g(p, 0.35, 0.009, 1.0) +
    g(p, 0.385, 0.011, -0.32) +
    g(p, 0.6, 0.055, 0.3);

interface TMonitorState {
    raf: number;
    unsub: () => void;
}
const mounted = new WeakMap<HTMLElement, TMonitorState>();

function start(
    el: HTMLElement,
    activity: TExoWritableBindable<number, number>
): void {
    if (mounted.has(el)) return; // singleton pane — start once
    const reduced =
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;

    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} 30`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    svg.style.filter = 'drop-shadow(0 0 2px var(--infection-green))';
    const poly = document.createElementNS(SVGNS, 'polyline');
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke-width', '1.3');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('stroke-linecap', 'round');
    poly.style.stroke = 'var(--infection-green)';
    const head = document.createElementNS(SVGNS, 'circle');
    head.setAttribute('r', '1.7');
    head.style.fill = 'var(--infection-green)';
    svg.appendChild(poly);
    svg.appendChild(head);
    el.appendChild(svg);

    const ys = new Array(W).fill(MID);
    const queue: number[] = [];
    let beatI = -1;

    const render = (): void => {
        let p = '';
        for (let i = 0; i < W; i++) p += i + ',' + ys[i].toFixed(1) + ' ';
        poly.setAttribute('points', p);
        head.setAttribute('cx', String(W - 1));
        head.setAttribute('cy', ys[W - 1].toFixed(1));
    };
    const advance = (steps: number): void => {
        for (let s = 0; s < steps; s++) {
            let y: number;
            if (beatI < 0 && queue.length) {
                queue.shift();
                beatI = 0;
            }
            if (beatI >= 0) {
                y = MID - pqrst(beatI / BEAT_LEN) * AMP;
                beatI++;
                if (beatI >= BEAT_LEN) beatI = -1;
            } else {
                y = MID + (Math.random() - 0.5) * 1.2;
            }
            ys.shift();
            ys.push(y);
        }
    };

    // Beat on real activity: a rise in the roster total.
    let last = activity.getValue();
    const unsub = activity.subscribe(() => {
        const v = activity.getValue();
        const delta = v - last;
        last = v;
        if (delta > 0) for (let i = 0; i < Math.min(delta, 4); i++) queue.push(1);
    });

    if (reduced) {
        // static strip: one settled beat, no sweep
        queue.push(1);
        advance(BEAT_LEN + 20);
        render();
        mounted.set(el, { raf: 0, unsub });
        return;
    }

    const loop = (): void => {
        if (el.isConnected) {
            advance(STEP);
            render();
        }
        const st = mounted.get(el);
        if (st) st.raf = requestAnimationFrame(loop);
    };
    mounted.set(el, { raf: requestAnimationFrame(loop), unsub });
}

function stop(el: HTMLElement): void {
    // Detach is transient for a reused pane — keep the loop alive (it idles while
    // detached). Only a true teardown would remove it; Exodra never re-mounts, so
    // stopping here would leave a dead strip on re-attach.
}

export function heartbeatMonitor(
    activity: TExoWritableBindable<number, number>
): TExoSchema {
    return (
        <div
            static={{
                title: 'live stimulation activity',
                style:
                    'width:132px;height:26px;flex:none;border:1px solid var(--border-primary);' +
                    'border-radius:3px;background:var(--bg-secondary);overflow:hidden',
                onExoMount: (n: { element: unknown }) =>
                    start(n.element as HTMLElement, activity),
                onExoUnmount: (n: { element: unknown }) =>
                    stop(n.element as HTMLElement),
            }}
        />
    );
}
