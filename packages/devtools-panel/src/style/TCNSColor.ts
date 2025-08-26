export type TCNSHex = `#${string}`;

export function TCNSHsl(h: number, s: number, l: number): TCNSHex {
    // h 0..360, s/l 0..100
    const _s = s / 100,
        _l = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = _s * Math.min(_l, 1 - _l);
    const f = (n: number) =>
        _l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to255 = (x: number) => Math.round(255 * x);
    const r = to255(f(0)),
        g = to255(f(8)),
        b = to255(f(4));
    return `#${[r, g, b]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')}` as TCNSHex;
}

export function TCNSWithAlpha(hex: TCNSHex, alpha: number): string {
    const a = Math.max(0, Math.min(1, alpha));
    const ar = Math.round(a * 255)
        .toString(16)
        .padStart(2, '0');
    return `${hex}${ar}`; // #rrggbbaa
}

export function TCNSLighten(hex: TCNSHex, amount = 8): TCNSHex {
    const [r, g, b] = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
    const tl = (v: number) =>
        Math.max(0, Math.min(255, v + Math.round((255 * amount) / 100)));
    const rr = tl(r),
        gg = tl(g),
        bb = tl(b);
    return `#${[rr, gg, bb]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')}` as TCNSHex;
}
