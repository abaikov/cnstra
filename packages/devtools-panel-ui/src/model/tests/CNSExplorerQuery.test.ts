import { CNSExplorerQuery } from '../CNSExplorerQuery';
import { DEFAULT_EXPLORER_QUERY } from '../constants/DEFAULT_EXPLORER_QUERY';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';

describe('the explorer query', () => {
    it('round-trips through the URL', () => {
        const query: TCNSExplorerQuery = {
            scopeName: 'app:main',
            status: 'failed',
            entryCollateralName: 'import-doc',
            text: 'stim-42',
            since: 1000,
            until: 2000,
            entryOnly: true,
            tab: 'neurons',
            selected: 'stim-42',
            selectedNeuron: 'importer',
            selectedCollateral: 'import-doc',
            selectedTask: 'att-1:3',
        };
        expect(CNSExplorerQuery.decode(CNSExplorerQuery.encode(query))).toEqual(query);
    });

    it('omits defaults from the URL and restores them', () => {
        expect(CNSExplorerQuery.encode(DEFAULT_EXPLORER_QUERY)).toBe('');
        expect(CNSExplorerQuery.decode('')).toEqual(DEFAULT_EXPLORER_QUERY);
    });

    it('restores the scheduled tab from the URL', () => {
        expect(CNSExplorerQuery.decode(CNSExplorerQuery.encode({ tab: 'scheduled' })).tab).toBe('scheduled');
    });

    it('ignores an unknown tab, falling back to the default', () => {
        expect(CNSExplorerQuery.decode('tab=bogus').tab).toBe('stimulations');
    });

    it('tolerates a leading ? and non-numeric ranges', () => {
        const query = CNSExplorerQuery.decode('?status=running&since=nope');
        expect(query.status).toBe('running');
        expect(query.since).toBeUndefined();
    });

    it('decodes the collaterals entry-only boolean filter', () => {
        expect(CNSExplorerQuery.decode('tab=collaterals&entry=1').entryOnly).toBe(true);
        expect(CNSExplorerQuery.decode('tab=collaterals').entryOnly).toBeUndefined();
    });
});
