import type { TExoSchema } from '@exodra/core';

// The panel's shared design-system primitives (the "how crude ребята do it" kit):
// small-caps accent eyebrows, status pills, big glowing stat numbers, outlined
// stat-cards, fact-bullet lists, a segmented proportion bar + legend, a LIVE pill,
// and the 3-zone scope card. Palette is LOCKED: violet = neutral/primary, green =
// ok/completed/live, red = errors/failed ONLY, yellow #F5C344 = running/caution +
// headings, muted grey = inactive.

export const C = {
    violet: 'var(--infection-purple)',
    green: 'var(--infection-green)',
    red: 'var(--infection-red)',
    yellow: 'var(--infection-yellow)',
    cyan: 'var(--infection-cyan)',
    pink: 'var(--infection-pink)',
    text: 'var(--text-primary)',
    muted: 'var(--text-muted)',
    sub: 'var(--text-secondary)',
    border: 'var(--border-primary)',
    card: 'var(--bg-card)',
    panel: 'var(--bg-panel)',
} as const;

/** Map an entity status → its semantic accent colour. */
export function statusColor(status: string): string {
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'ok' || s === 'done' || s === 'success')
        return C.green;
    if (s === 'failed' || s === 'error') return C.red;
    if (s === 'running' || s === 'pending' || s === 'active') return C.yellow;
    return C.muted;
}

/** Small-caps, letter-spaced, accent-coloured section eyebrow. */
export function eyebrow(text: string, color: string = C.violet): TExoSchema {
    return (
        <div
            static={{
                class: 'exp-heading',
                style: `font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${color};white-space:nowrap`,
            }}
        >
            {text}
        </div>
    );
}

/** Map a status → its subtle pulsing-glow CSS class (by semantic colour). */
export function statusGlowClass(status: string): string {
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'ok' || s === 'done' || s === 'success')
        return 'exp-glow-green';
    if (s === 'failed' || s === 'error') return 'exp-glow-red';
    if (s === 'running' || s === 'pending' || s === 'active')
        return 'exp-glow-yellow';
    return '';
}

/** Rounded status pill with a leading coloured dot that pulses by semantic colour. */
export function statusPill(status: string): TExoSchema {
    const col = statusColor(status);
    return (
        <span
            static={{
                style:
                    `display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;` +
                    `border:1px solid ${col};color:${col};background:${col}1a;` +
                    `font-size:10px;letter-spacing:1px;text-transform:uppercase;white-space:nowrap`,
            }}
        >
            <span
                static={{
                    class: `exp-status-dot ${statusGlowClass(status)}`,
                    style: `width:6px;height:6px;border-radius:50%;background:${col}`,
                }}
            />
            {status}
        </span>
    );
}

/** Green ● LIVE indicator. */
export function livePill(): TExoSchema {
    return (
        <span
            static={{
                style:
                    `display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;` +
                    `border:1px solid ${C.green};color:${C.green};background:${C.green}14;` +
                    `font-size:9px;letter-spacing:1.5px;text-transform:uppercase`,
            }}
        >
            <span static={{ class: 'exp-live-dot', style: `width:6px;height:6px;border-radius:50%;background:${C.green};box-shadow:0 0 6px ${C.green}` }} />
            Live
        </span>
    );
}

/** Big bold stat number (optional glow) + small-caps sub-label. */
export function bigStat(
    value: string | number,
    label: string,
    color: string = C.green
): TExoSchema {
    return (
        <div static={{ style: 'display:flex;flex-direction:column;gap:2px' }}>
            <div
                static={{
                    style: `font-size:30px;line-height:1;font-weight:700;color:${color};text-shadow:0 0 12px ${color}55;font-family:var(--font-body);font-variant-numeric:tabular-nums`,
                }}
            >
                {String(value)}
            </div>
            <div static={{ style: `font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted}` }}>
                {label}
            </div>
        </div>
    );
}

/** Outlined stat pill-card (big coloured number + muted small-caps label). */
export function statCard(
    value: string | number,
    label: string,
    color: string
): TExoSchema {
    return (
        <div
            static={{
                style:
                    `display:flex;flex-direction:column;gap:3px;padding:7px 10px;min-width:78px;` +
                    `border:1px solid ${color}66;border-radius:8px;background:${color}0f`,
            }}
        >
            <div static={{ style: `font-size:20px;font-weight:700;line-height:1;color:${color};font-family:var(--font-body);font-variant-numeric:tabular-nums` }}>
                {String(value)}
            </div>
            <div static={{ style: `font-size:8.5px;letter-spacing:1.2px;text-transform:uppercase;color:${C.muted};white-space:nowrap` }}>
                {label}
            </div>
        </div>
    );
}

export function statCardRow(cards: TExoSchema[]): TExoSchema {
    return <div static={{ style: 'display:flex;gap:8px;flex-wrap:wrap' }}>{cards}</div>;
}

/** One fact-bullet: accent dot + monospace stat line. */
export function factBullet(
    label: string,
    value: string | number,
    color: string = C.violet
): TExoSchema {
    return (
        <div static={{ style: 'display:flex;align-items:center;gap:8px;justify-content:flex-end' }}>
            <span static={{ style: `font-size:11px;color:${C.muted}` }}>{label}</span>
            <span static={{ style: `font-size:12px;color:${C.text};font-weight:600;min-width:28px;text-align:right` }}>{String(value)}</span>
            <span static={{ style: `width:6px;height:6px;border-radius:50%;background:${color};box-shadow:0 0 5px ${color};flex:none` }} />
        </div>
    );
}

export function factList(items: TExoSchema[]): TExoSchema {
    return (
        <div static={{ style: 'display:flex;flex-direction:column;gap:8px;align-items:flex-end' }}>
            {items}
        </div>
    );
}

export interface TProportionSeg {
    label: string;
    value: number;
    color: string;
}

/** Segmented multi-colour proportion bar + a wrapped legend. */
export function proportionBar(segs: TProportionSeg[]): TExoSchema {
    const total = segs.reduce((n, s) => n + s.value, 0) || 1;
    const bar = segs
        .filter(s => s.value > 0)
        .map(s => (
            <div
                static={{
                    title: `${s.label}: ${s.value}`,
                    style: `width:${((s.value / total) * 100).toFixed(2)}%;background:${s.color};box-shadow:inset 0 0 8px ${s.color}66`,
                }}
            />
        ));
    const legend = segs.map(s => (
        <span static={{ style: 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text-secondary);white-space:nowrap' }}>
            <span static={{ style: `width:8px;height:8px;border-radius:2px;background:${s.color}` }} />
            {s.label}
            <span static={{ style: `color:${C.muted};font-variant-numeric:tabular-nums` }}>{String(s.value)}</span>
        </span>
    ));
    return (
        <div static={{ style: 'display:flex;flex-direction:column;gap:8px' }}>
            <div static={{ style: `display:flex;height:12px;border-radius:6px;overflow:hidden;border:1px solid ${C.border};background:var(--bg-secondary)` }}>
                {bar.length ? bar : <div static={{ style: 'flex:1' }} />}
            </div>
            <div static={{ style: 'display:flex;flex-wrap:wrap;gap:6px 16px' }}>{legend}</div>
        </div>
    );
}

/** Thin progress bar (track + accent fill + caption). */
export function progressBar(
    ratio: number,
    caption: string,
    color: string = C.green
): TExoSchema {
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    return (
        <div static={{ style: 'display:flex;flex-direction:column;gap:4px' }}>
            <div static={{ style: `position:relative;height:6px;border-radius:4px;background:var(--bg-secondary);border:1px solid ${C.border}` }}>
                <div static={{ style: `position:absolute;left:0;top:0;bottom:0;width:${pct.toFixed(1)}%;background:${color};border-radius:4px;box-shadow:0 0 6px ${color}` }} />
            </div>
            <div static={{ style: `font-size:9.5px;letter-spacing:.5px;color:${C.muted}` }}>{caption}</div>
        </div>
    );
}

export interface TScopeCardOpts {
    eyebrow: string;
    eyebrowColor?: string;
    title: string;
    description: string;
    pills?: TExoSchema[];
    diagram: TExoSchema;
    facts: TExoSchema;
}

/** The 3-zone detail scope card: heading block · node-link diagram · fact bullets. */
export function scopeCard(o: TScopeCardOpts): TExoSchema {
    const accent = o.eyebrowColor ?? C.violet;
    return (
        <div
            static={{
                style:
                    `display:flex;flex-direction:column;gap:14px;padding:16px;` +
                    `border:1px solid ${C.border};border-left:3px solid ${accent};border-radius:10px;` +
                    `background:radial-gradient(140% 100% at 0% 0%, #212121 0%, #171717 70%);` +
                    `box-shadow:0 6px 24px rgba(0,0,0,.35)`,
            }}
        >
            <div static={{ style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start' }}>
                {/* left — heading block */}
                <div static={{ style: 'flex:1 1 200px;min-width:180px;display:flex;flex-direction:column;gap:8px' }}>
                    {eyebrow(o.eyebrow, accent)}
                    <div static={{ style: `font-size:19px;font-weight:700;color:${C.text};font-family:var(--font-body);word-break:break-word` }}>{o.title}</div>
                    <div static={{ style: `font-size:11.5px;line-height:1.5;color:${C.muted}` }}>{o.description}</div>
                    {o.pills && o.pills.length ? (
                        <div static={{ style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:2px' }}>{o.pills}</div>
                    ) : (
                        <div />
                    )}
                </div>
                {/* right — fact bullets */}
                <div static={{ style: 'flex:0 1 220px;min-width:170px' }}>{o.facts}</div>
            </div>
            {/* center (full width below) — the node-link diagram */}
            <div>{o.diagram}</div>
        </div>
    );
}
