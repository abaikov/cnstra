import type {
    TCNSStimulationRosterFilter,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterFacets,
} from '@cnstra/persist-dto';

/**
 * OPTIONAL store capability: push the retry-UI's roster query — filter, keyset
 * pagination, and the facet/histogram GROUP BY — down INTO the store (SQL),
 * instead of the caller loading every run and deriving it in memory.
 *
 * A store advertises it structurally (both methods present). Callers detect it
 * with {@link supportsCNSRosterQuery} and fall back to an in-memory derivation over
 * {@link ICNSStimulationReader} when it's absent — the results are identical, only
 * the work moves. The keyset `cursor` is the store's own opaque token (same store
 * must decode it); newest-first ordering (`startedAt DESC, stimulationId DESC`) is
 * part of the contract so cursors are stable.
 */
export interface ICNSStimulationRosterQuery {
    /** One newest-first keyset page of roster rows for the filter. */
    queryRoster(
        filter: TCNSStimulationRosterFilter,
        opts: { cursor?: string; limit: number }
    ): Promise<TCNSStimulationRosterPage>;
    /**
     * Aggregate counts over the WHOLE filtered set (not just a page).
     * `metricPath` (dot-path into the entry payload) adds a per-time-bucket sum.
     */
    queryFacets(
        filter: TCNSStimulationRosterFilter,
        opts?: { metricPath?: string }
    ): Promise<TCNSStimulationRosterFacets>;
}

/** Structural check: does this store push the roster query down itself? */
export function supportsCNSRosterQuery(
    store: unknown
): store is ICNSStimulationRosterQuery {
    return (
        !!store &&
        typeof (store as ICNSStimulationRosterQuery).queryRoster ===
            'function' &&
        typeof (store as ICNSStimulationRosterQuery).queryFacets === 'function'
    );
}
