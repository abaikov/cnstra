import { CNSExplorerAggregate } from '../../model/CNSExplorerAggregate';
import type { TCNSNeuronRow } from '../../types/TCNSNeuronRow';
import { EMPTY_EXPLORER_TOPOLOGY } from '../../constants/EMPTY_EXPLORER_TOPOLOGY';
import { EMPTY_STIMULATION_FACETS } from '../../constants/EMPTY_STIMULATION_FACETS';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { neuronRowMachine } from './neuronRowMachine';
import { createWindowedListOptions } from './createWindowedListOptions';

export const neuronListOptions = createWindowedListOptions<TCNSNeuronRow>({
    listName: 'neurons',
    keyOf: row => row.name,
    rowMachine: neuronRowMachine,
    itemsOf: c => {
        const query = CNSExplorerReads.queryOf(c);
        const topology = CNSExplorerReads.topologyOf(c, query) ?? EMPTY_EXPLORER_TOPOLOGY;
        const facets = CNSExplorerReads.facetsOf(c, query) ?? EMPTY_STIMULATION_FACETS;
        return { items: CNSExplorerAggregate.neuronRows(topology, CNSExplorerReads.snapshotOf(c, query), facets), emptyText: 'No neurons yet — topology loads on connect.' };
    },
});
