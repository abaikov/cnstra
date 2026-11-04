import { hashCNSHomeostatKey } from '@cnstra/sync';
import { CNSExplorerSyncKeys } from '../../model/CNSExplorerSyncKeys';
import type { TCNSScheduledFilter } from '../../types/TCNSScheduledFilter';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { scheduledRowMachine } from '../scheduled/scheduledRowMachine';
import { UNAVAILABLE_SCHEDULED_HINT } from '../../constants/UNAVAILABLE_SCHEDULED_HINT';
import { createWindowedListOptions } from './createWindowedListOptions';

const EVERY_SCHEDULED: TCNSScheduledFilter = {};
const EVERY_SCHEDULED_QUERY_KEY = hashCNSHomeostatKey(CNSExplorerSyncKeys.scheduledPage(EVERY_SCHEDULED, undefined));

export const scheduledListOptions = createWindowedListOptions<string>({
    listName: 'scheduled',
    queryKeyOf: () => EVERY_SCHEDULED_QUERY_KEY,
    keyOf: stimulationId => stimulationId,
    rowMachine: scheduledRowMachine,
    itemsOf: (c, paging) => {
        const { rows, hasMore, isLoading, first } = CNSExplorerReads.scheduledStimulationIdsOf(c, EVERY_SCHEDULED, paging.pageCount);
        return {
            items: rows,
            emptyText: first?.available === false ? UNAVAILABLE_SCHEDULED_HINT : 'Nothing is scheduled.',
            pagination: { queryKey: EVERY_SCHEDULED_QUERY_KEY, hasMore, isLoading, nextCursor: null, isHeadCut: false },
        };
    },
});
