import type {
    TCNSStimulationRosterFilter,
    TCNSStimulationRosterRow,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterFacets,
    TCNSStimulationRosterTimeBucket,
} from '@cnstra/persist-dto';
import type { ICNSStimulationReader } from './interfaces/ICNSStimulationRepository';

/**
 * The reference derivation for the roster query — shared by every store that
 * cannot push it into SQL (the in-memory store, and the devtools-server fallback).
 * A Postgres store overrides this with equivalent set-based SQL; the semantics
 * here ARE the contract those queries must match.
 */

/** One enriched run: its roster row + the neuron names it activated. */
export type TCNSRosterEntry = {
    row: TCNSStimulationRosterRow;
    neurons: string[];
};

/** Resolve a dot-path (`a.b.c`) into a payload; undefined on any miss. */
export function resolveCNSPayloadPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const key of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

/**
 * Buckets in the Chart histogram. Exported because a store that pushes the
 * histogram into SQL has to derive the SAME bucket width, and two copies of this
 * number would silently disagree about where a run belongs.
 */
export const CNS_HISTOGRAM_BUCKETS = 40;

/**
 * Load every run for `filter.scopeName`, derive its roster row + activated
 * neurons from its attempts/tasks, apply the in-memory filter, and sort
 * newest-first (`startedAt DESC, stimulationId DESC`).
 */
export async function loadCNSRosterEntries(
    reader: ICNSStimulationReader,
    filter: TCNSStimulationRosterFilter
): Promise<TCNSRosterEntry[]> {
    // The window goes to the store so it can prune BEFORE the enrichment below,
    // which reads every attempt and every task of every run it is handed. A store
    // that ignores `since` is still correct — `matchesRosterFilter` applies it
    // again at the end — it just does more work to get there.
    const stims = await reader.listStimulations({
        ...(filter.scopeName ? { scopeName: filter.scopeName } : {}),
        ...(filter.since != null ? { since: filter.since } : {}),
    });
    const enriched: TCNSRosterEntry[] = [];
    for (const s of stims) {
        const attempts = await reader.getAttempts(s.stimulationId);
        // Fold rather than spread — same argument-limit hazard as the histogram.
        const startedAt = attempts.reduce(
            (m, a) => (a.startedAt < m ? a.startedAt : m),
            attempts.length ? attempts[0]!.startedAt : 0
        );
        const last = attempts[attempts.length - 1];
        const completedAt =
            s.status === 'running' ? null : last?.completedAt ?? null;
        const hopCount = attempts.reduce((n, a) => n + a.hopCount, 0);
        const neurons = new Set<string>();
        for (const a of attempts) {
            const tasks = await reader.getTasks(a.stimulationAttemptId);
            for (const t of tasks) neurons.add(t.neuronName);
        }
        enriched.push({
            row: {
                stimulationId: s.stimulationId,
                scopeName: s.scopeName,
                entry: s.entry,
                status: s.status,
                startedAt,
                completedAt,
                hopCount,
                hasError: s.status === 'failed',
            },
            neurons: [...neurons],
        });
    }
    const matched = enriched.filter(({ row: r, neurons }) =>
        matchesCNSRosterFilter(r, neurons, filter)
    );
    matched.sort(
        (a, b) =>
            b.row.startedAt - a.row.startedAt ||
            (a.row.stimulationId < b.row.stimulationId ? 1 : -1)
    );
    return matched;
}

/** Does a row (with its activated neurons) satisfy every set filter field? */
export function matchesCNSRosterFilter(
    r: TCNSStimulationRosterRow,
    neurons: string[],
    f: TCNSStimulationRosterFilter
): boolean {
    return (
        (f.status === undefined || r.status === f.status) &&
        (f.entryCollateralName === undefined ||
            r.entry.collateralName === f.entryCollateralName) &&
        (f.neuronName === undefined || neurons.includes(f.neuronName)) &&
        (f.text === undefined ||
            r.stimulationId.toLowerCase().includes(f.text.toLowerCase())) &&
        (f.since === undefined || r.startedAt >= f.since) &&
        (f.until === undefined || r.startedAt <= f.until)
    );
}

/** Keyset cursor = base64(`${startedAt}|${stimulationId}`). */
export function encodeCNSRosterCursor(r: TCNSStimulationRosterRow): string {
    return Buffer.from(
        `${r.startedAt}|${r.stimulationId}`,
        'utf8'
    ).toString('base64');
}

/**
 * Decode a keyset cursor back into the `(startedAt, stimulationId)` ORDER BY key
 * it carries. `undefined` for anything unreadable — a caller that cannot tell
 * where the cursor points must start from the top, not from a garbage key.
 */
function decodeRosterCursor(
    cursor: string
): { startedAt: number; stimulationId: string } | undefined {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    // Split on the FIRST separator: the id is the remainder, so an id that
    // happens to contain `|` still round-trips.
    const sep = decoded.indexOf('|');
    if (sep < 0) return undefined;
    const startedAt = Number(decoded.slice(0, sep));
    if (!Number.isFinite(startedAt)) return undefined;
    return { startedAt, stimulationId: decoded.slice(sep + 1) };
}

/** Slice one keyset page out of the already-sorted rows. */
export function keysetPage(
    allRows: TCNSStimulationRosterRow[],
    opts: { cursor?: string; sinceCursor?: string; limit: number }
): TCNSStimulationRosterPage {
    const since = opts.sinceCursor ? decodeRosterCursor(opts.sinceCursor) : undefined;
    const rows = since
        ? allRows.filter(r => r.startedAt > since.startedAt || (r.startedAt === since.startedAt && r.stimulationId >= since.stimulationId))
        : allRows;
    let start = 0;
    const key = opts.cursor ? decodeRosterCursor(opts.cursor) : undefined;
    if (key) {
        // Page by the cursor's KEY, never by locating the cursor's row. The row
        // goes missing routinely — under `status: 'running'` the run the user just
        // paged past leaves the filtered set the moment it completes, and a
        // bounded store evicts old runs outright. Looking it up and falling back
        // to index 0 on a miss handed the panel page 1 again, with a fresh
        // `nextCursor`: the same rows appended forever.
        //
        // The rows are sorted `(startedAt DESC, stimulationId DESC)` and the key
        // names a position in exactly that order, so the page is the rows strictly
        // AFTER it — defined whether or not the row itself survived. This is the
        // `(started_at, stimulation_id) < ($8, $9)` the Postgres store already
        // applies; the two are contractually identical.
        start = rows.length;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i]!;
            if (
                r.startedAt < key.startedAt ||
                (r.startedAt === key.startedAt &&
                    r.stimulationId < key.stimulationId)
            ) {
                start = i;
                break;
            }
        }
    }
    const page = rows.slice(start, start + opts.limit);
    const hasMore = start + opts.limit < rows.length;
    const lastRow = page[page.length - 1];
    return {
        rows: page,
        nextCursor: hasMore && lastRow ? encodeCNSRosterCursor(lastRow) : null,
        total: allRows.length,
    };
}

/** GROUP BY over the full filtered set → the facet rail + Chart histogram. */
export function computeCNSRosterFacets(
    entries: TCNSRosterEntry[],
    opts?: { metricPath?: string }
): TCNSStimulationRosterFacets {
    const rows = entries.map(e => e.row);
    const tally = <TKey extends string>(values: TKey[]): { key: TKey; count: number }[] => {
        const m = new Map<TKey, number>();
        for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
        return [...m.entries()]
            .map(([key, count]) => ({ key, count }))
            .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
    };
    return {
        byEntryCollateral: tally(rows.map(r => r.entry.collateralName)).map(
            x => ({ name: x.key, count: x.count })
        ),
        byStatus: tally(rows.map(r => r.status)).map(x => ({
            status: x.key,
            count: x.count,
        })),
        byNeuron: tally(entries.flatMap(e => e.neurons)).map(x => ({
            name: x.key,
            count: x.count,
        })),
        byTime: buildCNSTimeHistogram(rows, opts?.metricPath),
    };
}

/** Bucket rows over time into a fixed number of buckets; optional metric sum. */
export function buildCNSTimeHistogram(
    rows: TCNSStimulationRosterRow[],
    metricPath?: string
): TCNSStimulationRosterTimeBucket[] {
    rows = rows.filter(r => r.startedAt > 0);
    if (rows.length === 0) return [];
    // Fold, never spread: `Math.min(...times)` passes one argument per row and blows
    // the engine's argument limit (~125k) on a large result set — a RangeError instead
    // of a histogram.
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
        if (r.startedAt < min) min = r.startedAt;
        if (r.startedAt > max) max = r.startedAt;
    }
    const size = Math.max(1, Math.ceil((max - min) / CNS_HISTOGRAM_BUCKETS) || 1);
    const byBucket = new Map<number, TCNSStimulationRosterTimeBucket>();
    for (const r of rows) {
        const tsBucket = min + Math.floor((r.startedAt - min) / size) * size;
        let b = byBucket.get(tsBucket);
        if (!b) {
            b = { tsBucket, completed: 0, failed: 0, running: 0 };
            byBucket.set(tsBucket, b);
        }
        if (r.status === 'completed') b.completed++;
        else if (r.status === 'failed') b.failed++;
        else b.running++;
        if (metricPath) {
            const v = resolveCNSPayloadPath(r.entry.payload, metricPath);
            if (typeof v === 'number' && Number.isFinite(v))
                b.metric = (b.metric ?? 0) + v;
        }
    }
    return [...byBucket.values()].sort((a, b) => a.tsBucket - b.tsBucket);
}
