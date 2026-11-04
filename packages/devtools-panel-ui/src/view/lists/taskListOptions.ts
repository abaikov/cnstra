import { CNSExplorerAggregate } from '../../model/CNSExplorerAggregate';
import type { TCNSTaskRow } from '../../types/TCNSTaskRow';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { taskRowMachine } from './taskRowMachine';
import { createWindowedListOptions } from './createWindowedListOptions';

export const taskListOptions = createWindowedListOptions<TCNSTaskRow>({
    listName: 'tasks',
    keyOf: row => row.key,
    rowMachine: taskRowMachine,
    itemsOf: c => {
        const query = CNSExplorerReads.queryOf(c);
        const rows = CNSExplorerAggregate.taskRows(CNSExplorerReads.snapshotOf(c, query));
        return {
            items: query.neuronName ? rows.filter(row => row.neuronName === query.neuronName) : rows,
            emptyText: 'No activation tasks in the loaded snapshot yet.',
        };
    },
});
