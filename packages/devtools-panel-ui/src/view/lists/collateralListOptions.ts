import { CNSExplorerAggregate } from '../../model/CNSExplorerAggregate';
import type { TCNSCollateralRow } from '../../types/TCNSCollateralRow';
import { EMPTY_EXPLORER_TOPOLOGY } from '../../constants/EMPTY_EXPLORER_TOPOLOGY';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { collateralRowMachine } from './collateralRowMachine';
import { createWindowedListOptions } from './createWindowedListOptions';

export const collateralListOptions = createWindowedListOptions<TCNSCollateralRow>({
    listName: 'collaterals',
    keyOf: row => row.name,
    rowMachine: collateralRowMachine,
    itemsOf: c => {
        const query = CNSExplorerReads.queryOf(c);
        const rows = CNSExplorerAggregate.collateralRows(CNSExplorerReads.topologyOf(c, query) ?? EMPTY_EXPLORER_TOPOLOGY, CNSExplorerReads.snapshotOf(c, query));
        return { items: query.entryOnly ? rows.filter(row => row.isEntry) : rows, emptyText: 'No collaterals in range.' };
    },
});
