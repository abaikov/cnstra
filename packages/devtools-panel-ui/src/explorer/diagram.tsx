import type { TExoSchema } from '@exodra/core';

// The node-link diagram — the panel's living centrepiece. A kind-styled SOURCE node
// in the centre, curved cubic-bézier edges fanning IN from the left and OUT to the
// right, and a signal DOT that flows ALONG each edge via <animateMotion><mpath>
// (frozen under prefers-reduced-motion). The two entity KINDS are visually distinct
// and LABELED so a first-time viewer tells them apart instantly:
//   • NEURON     = a rounded-RECT box, violet accent, `▪ NEURON` tag.
//   • COLLATERAL = a PILL (fully-rounded), cyan accent, `◦ COLLATERAL` tag.
// A collateral is always a NODE; "dendrite"/"axon" name the RELATIONSHIP (the edge/
// section), never the node — node sub-lines carry the ROLE (input/output/owner/…).
// Built with createElementNS because Exodra JSX doesn't own the SVG namespace.

const SVGNS = 'http://www.w3.org/2000/svg';
const VW = 640; // viewBox width (coordinate space; scales to the container)
const BOX_W = 184;
const BOX_H = 46;
const GAP = 12;
const CW = 158; // centre node width
const CH = 52;
const MAX_SHOW = 8;
const CX = VW / 2;

export type TDiagramState = 'ok' | 'error' | 'idle';
export type TDiagramNodeKind = 'neuron' | 'collateral';

export interface TDiagramTarget {
    id: string;
    kind: TDiagramNodeKind;
    title: string;
    /** Role/stat sub-line, e.g. `input · 128` or `owner`. */
    sub?: string;
    subColor?: string;
    /** Traffic weight → stroke width/opacity + dot speed. */
    weight: number;
    state: TDiagramState;
    onClick?: () => void;
}

export interface TDiagramConfig {
    sourceKind: TDiagramNodeKind;
    sourceLabel: string;
    left: TDiagramTarget[];
    right: TDiagramTarget[];
    leftHeading?: string;
    rightHeading?: string;
}

const el = (
    tag: string,
    attrs: Record<string, string | number> = {}
): SVGElement => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n as SVGElement;
};

const COLOR = {
    neuron: 'var(--infection-purple)',
    collateral: 'var(--infection-cyan)',
    green: 'var(--infection-green)',
    red: 'var(--infection-red)',
    idle: 'var(--border-accent)',
    box: '#191919',
    text: 'var(--text-primary)',
    muted: 'var(--text-muted)',
};

const accentFor = (kind: TDiagramNodeKind): string =>
    kind === 'neuron' ? COLOR.neuron : COLOR.collateral;
const tagFor = (kind: TDiagramNodeKind): string =>
    kind === 'neuron' ? '▪ NEURON' : '◦ COLLATERAL';

const trunc = (s: string, n: number): string =>
    s.length > n ? s.slice(0, n - 1) + '…' : s;

let uid = 0;

/** Draw a kind-styled node (box for neuron, pill for collateral) + tag + role. */
function drawNode(
    svg: SVGElement,
    x: number,
    y: number,
    w: number,
    h: number,
    t: {
        kind: TDiagramNodeKind;
        title: string;
        sub?: string;
        subColor?: string;
        state: TDiagramState;
        onClick?: () => void;
    },
    center = false
): void {
    const g = el('g', { class: t.onClick ? 'dg-node dg-click' : 'dg-node' });
    if (t.onClick) (g as SVGElement).style.cursor = 'pointer';
    const accent = t.state === 'error' ? COLOR.red : accentFor(t.kind);
    const rx = t.kind === 'collateral' ? h / 2 : 9;
    const top = y - h / 2;
    const rect = el('rect', {
        x,
        y: top,
        width: w,
        height: h,
        rx,
        fill: COLOR.box,
        stroke: accent,
        'stroke-width': center ? 2 : 1.4,
    });
    (rect as SVGElement).style.filter = `drop-shadow(0 0 ${center ? 6 : 3}px ${accent})`;
    g.appendChild(rect);

    const anchor = center ? 'middle' : 'start';
    const tx = center ? x + w / 2 : x + 13;
    // type tag
    const tag = el('text', {
        x: tx,
        y: top + 14,
        fill: accent,
        'font-size': 8,
        'letter-spacing': 1,
        'text-anchor': anchor,
    });
    tag.textContent = tagFor(t.kind);
    g.appendChild(tag);
    // title
    const title = el('text', {
        x: tx,
        y: t.sub ? y + 3 : y + 6,
        fill: COLOR.text,
        'font-size': center ? 13.5 : 12.5,
        'font-weight': center ? '700' : '400',
        'font-family': 'var(--font-body)',
        'text-anchor': anchor,
    });
    title.textContent = trunc(t.title, center ? 18 : 19);
    g.appendChild(title);
    // role / stat sub-line
    if (t.sub) {
        const sub = el('text', {
            x: tx,
            y: y + 16,
            fill: t.subColor ?? COLOR.muted,
            'font-size': 9.5,
            'font-family': 'var(--font-body)',
            'text-anchor': anchor,
        });
        sub.textContent = t.sub;
        g.appendChild(sub);
    }
    // status glyph (top-right)
    if (!center) {
        const glyph = el('text', {
            x: x + w - 12,
            y: top + 14,
            fill: t.state === 'error' ? COLOR.red : COLOR.green,
            'font-size': 11,
            'text-anchor': 'end',
        });
        glyph.textContent =
            t.state === 'error' ? '🔒' : t.state === 'ok' ? '✓' : '·';
        g.appendChild(glyph);
        // click affordance — a faint arrow, always visible; brightens on hover
        if (t.onClick) {
            const arrow = el('text', {
                class: 'dg-open',
                x: x + w - 12,
                y: y + 15,
                fill: accent,
                'font-size': 12,
                'text-anchor': 'end',
                opacity: 0.55,
            });
            arrow.textContent = '›';
            g.appendChild(arrow);
        }
    }
    if (t.onClick) g.addEventListener('click', t.onClick);
    svg.appendChild(g);
}

function buildSvg(host: HTMLElement, cfg: TDiagramConfig): void {
    host.textContent = '';
    const reduced =
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;

    const left = cfg.left.slice(0, MAX_SHOW);
    const right = cfg.right.slice(0, MAX_SHOW);
    const rows = Math.max(left.length, right.length, 1);
    const H = Math.max(160, rows * (BOX_H + GAP) + 44);
    const cy = H / 2;

    const svg = el('svg', {
        viewBox: `0 0 ${VW} ${H}`,
        preserveAspectRatio: 'xMidYMid meet',
        width: '100%',
    });
    (svg as SVGSVGElement).style.cssText = `display:block;width:100%;height:${H}px;max-height:${H}px`;

    // subtle grid
    const defs = el('defs');
    const gid = `grid-${uid++}`;
    const pattern = el('pattern', {
        id: gid,
        width: 26,
        height: 26,
        patternUnits: 'userSpaceOnUse',
    });
    pattern.appendChild(
        el('path', {
            d: 'M 26 0 L 0 0 0 26',
            fill: 'none',
            stroke: 'rgba(82,167,201,0.08)',
            'stroke-width': 1,
        })
    );
    defs.appendChild(pattern);
    svg.appendChild(defs);
    svg.appendChild(el('rect', { x: 0, y: 0, width: VW, height: H, fill: `url(#${gid})` }));

    const maxW = Math.max(1, ...left.map(t => t.weight), ...right.map(t => t.weight));

    const layout = (n: number): number[] => {
        const total = n * BOX_H + (n - 1) * GAP;
        const top = cy - total / 2;
        return Array.from({ length: n }, (_, i) => top + i * (BOX_H + GAP) + BOX_H / 2);
    };

    const drawEdge = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        t: TDiagramTarget
    ): void => {
        const w = t.weight / maxW;
        const has = t.weight > 0;
        const eid = `edge-${uid++}`;
        const dx = (x2 - x1) * 0.5;
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
        const stroke = t.state === 'error' ? COLOR.red : accentFor(t.kind);
        const path = el('path', {
            id: eid,
            d,
            fill: 'none',
            stroke: has ? stroke : COLOR.idle,
            'stroke-width': has ? 1.4 + 2.6 * w : 1,
            'stroke-linecap': 'round',
            opacity: has ? 0.4 + 0.5 * w : 0.4,
        });
        if (!has) path.setAttribute('stroke-dasharray', '3 5');
        if (has) (path as SVGElement).style.filter = `drop-shadow(0 0 2px ${stroke})`;
        svg.appendChild(path);

        if (has) {
            const dot = el('circle', {
                r: 2.6 + 1.4 * w,
                fill: t.state === 'error' ? COLOR.red : '#eafbc7',
            });
            (dot as SVGElement).style.filter = `drop-shadow(0 0 3px ${
                t.state === 'error' ? COLOR.red : COLOR.green
            })`;
            if (reduced) {
                dot.setAttribute('cx', String((x1 + x2) / 2));
                dot.setAttribute('cy', String((y1 + y2) / 2));
            } else {
                const am = el('animateMotion', {
                    dur: `${(2.4 - 1.4 * w).toFixed(2)}s`,
                    repeatCount: 'indefinite',
                });
                const mp = el('mpath');
                mp.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${eid}`);
                mp.setAttribute('href', `#${eid}`);
                am.appendChild(mp);
                dot.appendChild(am);
            }
            svg.appendChild(dot);
        }
    };

    const leftY = layout(left.length);
    const rightY = layout(right.length);
    const cLeft = CX - CW / 2;
    const cRight = CX + CW / 2;
    // edges (behind), then side nodes, then centre (on top)
    left.forEach((t, i) => drawEdge(cLeft, cy, 8 + BOX_W, leftY[i], t));
    right.forEach((t, i) => drawEdge(cRight, cy, VW - 8 - BOX_W, rightY[i], t));
    left.forEach((t, i) => drawNode(svg, 8, leftY[i], BOX_W, BOX_H, t));
    right.forEach((t, i) => drawNode(svg, VW - 8 - BOX_W, rightY[i], BOX_W, BOX_H, t));

    // centre (source) node — kind-styled + labeled
    drawNode(
        svg,
        cLeft,
        cy,
        CW,
        CH,
        { kind: cfg.sourceKind, title: cfg.sourceLabel, state: 'ok' },
        true
    );

    // side headings (name the relationship / direction; nodes stay collaterals)
    const heading = (x: number, anchor: string, text: string): void => {
        if (!text) return;
        const h = el('text', {
            x,
            y: 15,
            fill: COLOR.muted,
            'font-size': 9,
            'text-anchor': anchor,
            'letter-spacing': 1.5,
        });
        h.textContent = text;
        svg.appendChild(h);
    };
    heading(8, 'start', left.length ? cfg.leftHeading ?? '' : '');
    heading(VW - 8, 'end', right.length ? cfg.rightHeading ?? '' : '');

    host.appendChild(svg);
}

/**
 * A node-link diagram. Rebuild it reactively by re-invoking the returned schema
 * inside a `combine` (each mount rebuilds the SVG from the passed config).
 */
export function nodeLinkDiagram(config: TDiagramConfig): TExoSchema {
    return (
        <div
            static={{
                style:
                    'width:100%;border:1px solid var(--border-primary);border-radius:8px;' +
                    'background:radial-gradient(120% 120% at 50% 0%, #202020 0%, #161616 100%);overflow:hidden',
                onExoMount: (n: { element: unknown }) =>
                    buildSvg(n.element as HTMLElement, config),
            }}
        />
    );
}
