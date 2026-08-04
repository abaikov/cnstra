import {
    DEFAULT_QUERY,
    encodeQuery,
    decodeQuery,
    toggleFilter,
    toServerFilter,
    type TCNSExplorerQuery,
} from './queryState';

describe('explorer queryState', () => {
    it('round-trips through the URL', () => {
        const q: TCNSExplorerQuery = {
            scopeName: 'app:main',
            status: 'failed',
            entryCollateralName: 'import-doc',
            text: 'stim-42',
            since: 1000,
            until: 2000,
            view: 'waterfall',
            lens: 'neurons',
            selected: 'stim-42',
        };
        expect(decodeQuery(encodeQuery(q))).toEqual(q);
    });

    it('omits defaults from the URL and restores them', () => {
        expect(encodeQuery(DEFAULT_QUERY)).toBe('');
        expect(decodeQuery('')).toEqual(DEFAULT_QUERY);
    });

    it('ignores unknown view/lens, falling back to defaults', () => {
        const q = decodeQuery('view=bogus&lens=bogus');
        expect(q.view).toBe('runs');
        expect(q.lens).toBe('collaterals');
    });

    it('tolerates a leading ? and non-numeric ranges', () => {
        const q = decodeQuery('?status=running&since=nope');
        expect(q.status).toBe('running');
        expect(q.since).toBeUndefined();
    });

    it('toggleFilter sets then clears a facet value', () => {
        const a = toggleFilter(DEFAULT_QUERY, 'status', 'failed');
        expect(a.status).toBe('failed');
        const b = toggleFilter(a, 'status', 'failed');
        expect(b.status).toBeUndefined();
    });

    it('toServerFilter carries only the set filter fields', () => {
        expect(
            toServerFilter({ ...DEFAULT_QUERY, status: 'failed', text: 'x' })
        ).toEqual({ status: 'failed', text: 'x' });
        expect(toServerFilter(DEFAULT_QUERY)).toEqual({});
    });
});
