// Small shared formatting/array helpers, previously copy-pasted across UI files.

/** Filter out null/undefined, narrowing the element type. */
export const notNull = <T,>(a: readonly (T | undefined | null)[]): T[] =>
    a.filter((x): x is T => x != null);

/** Local time-of-day string for a millisecond timestamp. */
export const fmtTime = (ts: number): string =>
    new Date(ts).toLocaleTimeString();

/** Round to 2 decimals. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Cytoscape node id for a topology node — the ONLY place a `${cnsId}:${name}`
 * string is built, and only at render (never stored). Names are the model; this
 * scalar exists purely because cytoscape needs a single-string node id.
 */
export const nodeKey = (cnsId: string, name: string): string =>
    `${cnsId}:${name}`;
