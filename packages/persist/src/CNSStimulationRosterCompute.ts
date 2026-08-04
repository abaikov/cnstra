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
export interface TCNSRosterEntry {
    row: TCNSStimulationRosterRow;
    neurons: string[];
}

/** Resolve a dot-path (`a.b.c`) into a payload; undefined on any miss. */
export function resolvePayloadPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const key of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

const HISTOGRAM_BUCKETS = 40;

/**
 * Load every run for `filter.scopeName`, derive its roster row + activated
 * neurons from its attempts/tasks, apply the in-memory filter, and sort
 * newest-first (`startedAt DESC, stimulationId DESC`).
 */
export async function loadRosterEntries(
    reader: ICNSStimulationReader,
    filter: TCNSStimulationRosterFilter
): Promise<TCNSRosterEntry[]> {
    const stims = await reader.listStimulations(
        filter.scopeName ? { scopeName: filter.scopeName } : undefined
    );
    const enriched: TCNSRosterEntry[] = [];
    for (const s of stims) {
        const attempts = await reader.getAttempts(s.stimulationId);
        const startedAt = attempts.length
            ? Math.min(...attempts.map(a => a.startedAt))
            : 0;
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
        matchesRosterFilter(r, neurons, filter)
    );
    matched.sort(
        (a, b) =>
            b.row.startedAt - a.row.startedAt ||
            (a.row.stimulationId < b.row.stimulationId ? 1 : -1)
    );
    return matched;
}

/** Does a row (with its activated neurons) satisfy every set filter field? */
export function matchesRosterFilter(
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
export function encodeRosterCursor(r: TCNSStimulationRosterRow): string {
    return Buffer.from(
        `${r.startedAt}|${r.stimulationId}`,
        'utf8'
    ).toString('base64');
}

/** Slice one keyset page out of the already-sorted rows. */
export function keysetPage(
    rows: TCNSStimulationRosterRow[],
    opts: { cursor?: string; limit: number }
): TCNSStimulationRosterPage {
    let start = 0;
    if (opts.cursor) {
        const decoded = Buffer.from(opts.cursor, 'base64').toString('utf8');
        const idx = rows.findIndex(
            r => `${r.startedAt}|${r.stimulationId}` === decoded
        );
        if (idx >= 0) start = idx + 1;
    }
    const page = rows.slice(start, start + opts.limit);
    const hasMore = start + opts.limit < rows.length;
    const lastRow = page[page.length - 1];
    return {
        rows: page,
        nextCursor: hasMore && lastRow ? encodeRosterCursor(lastRow) : null,
        total: rows.length,
    };
}

/** GROUP BY over the full filtered set → the facet rail + Chart histogram. */
export function computeRosterFacets(
    entries: TCNSRosterEntry[],
    opts?: { metricPath?: string }
): TCNSStimulationRosterFacets {
    const rows = entries.map(e => e.row);
    const tally = (values: string[]): { key: string; count: number }[] => {
        const m = new Map<string, number>();
        for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
        return [...m.entries()]
            .map(([key, count]) => ({ key, count }))
            .sort((a, b) => b.count - a.count);
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
        byTime: buildTimeHistogram(rows, opts?.metricPath),
    };
}

/** Bucket rows over time into a fixed number of buckets; optional metric sum. */
export function buildTimeHistogram(
    rows: TCNSStimulationRosterRow[],
    metricPath?: string
): TCNSStimulationRosterTimeBucket[] {
    if (rows.length === 0) return [];
    const times = rows.map(r => r.startedAt);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const size = Math.max(1, Math.ceil((max - min) / HISTOGRAM_BUCKETS) || 1);
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
            const v = resolvePayloadPath(r.entry.payload, metricPath);
            if (typeof v === 'number' && Number.isFinite(v))
                b.metric = (b.metric ?? 0) + v;
        }
    }
    return [...byBucket.values()].sort((a, b) => a.tsBucket - b.tsBucket);
}
