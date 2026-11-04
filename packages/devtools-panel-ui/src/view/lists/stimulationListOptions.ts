import { hashCNSHomeostatKey } from '@cnstra/sync';
import { CNSExplorerSyncKeys } from '../../model/CNSExplorerSyncKeys';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { stimulationRowMachine } from './stimulationRowMachine';
import { createWindowedListOptions } from './createWindowedListOptions';

const stimulationPagingKeyOf = (query: TCNSExplorerQuery): string => hashCNSHomeostatKey(CNSExplorerSyncKeys.stimulationPage(query, {}));

export const stimulationListOptions = createWindowedListOptions<string>({
    listName: 'stimulations',
    queryKeyOf: c => stimulationPagingKeyOf(CNSExplorerReads.queryOf(c)),
    keyOf: stimulationId => stimulationId,
    rowMachine: stimulationRowMachine,
    itemsOf: (c, paging) => {
        const query = CNSExplorerReads.queryOf(c);
        const { rows, hasMore, isLoading, nextCursor, isHeadCut } = CNSExplorerReads.stimulationIdsOf(c, query, paging);
        return {
            items: rows,
            emptyText: 'No stimulations yet — they appear as the app stimulates (or clear filters).',
            pagination: { queryKey: stimulationPagingKeyOf(query), hasMore, isLoading, nextCursor, isHeadCut },
        };
    },
});
