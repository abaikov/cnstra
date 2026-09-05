// Small shared formatting/array helpers, previously copy-pasted across UI files.

/** Filter out null/undefined, narrowing the element type. */
export const notNull = <T,>(a: readonly (T | undefined | null)[]): T[] =>
    a.filter((x): x is T => x != null);

/** Local time-of-day string for a millisecond timestamp. */
export const fmtTime = (ts: number): string =>
    new Date(ts).toLocaleTimeString();

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hhmm = (d: Date): string =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Span-aware axis label. The chart's time-axis granularity must follow the
 * SELECTED time range: seconds when you're looking at minutes, but a DATE
 * ("5 Aug") once the range spans days/months — otherwise a 90-day chart shows
 * only wandering clock times and no day at all. `spanMs` = last − first bucket.
 */
export const fmtAxis = (ts: number, spanMs: number): string => {
    const d = new Date(ts);
    const day = `${d.getDate()} ${MON[d.getMonth()]}`;
    if (spanMs >= 3 * 864e5) return day; // ≥ ~3 days → date only
    if (spanMs >= 12 * 36e5) return `${day} ${hhmm(d)}`; // ≥ 12h → date + time
    if (spanMs >= 30 * 6e4) return hhmm(d); // ≥ 30m → HH:MM
    return d.toLocaleTimeString(); // sub-30m → HH:MM:SS
};

/** Full local date+time stamp — used where a label must be unambiguous (hover tooltip). */
export const fmtStamp = (ts: number): string => new Date(ts).toLocaleString();

/** Round to 2 decimals. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Cytoscape node id for a topology node — the ONLY place a `${cnsId}:${name}`
 * string is built, and only at render (never stored). Names are the model; this
 * scalar exists purely because cytoscape needs a single-string node id.
 */
export const nodeKey = (cnsId: string, name: string): string =>
    `${cnsId}:${name}`;
