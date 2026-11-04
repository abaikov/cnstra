import type { TCNSTypeaheadOptions } from '../../types/TCNSTypeaheadOptions';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';

export const neuronTypeaheadOptions: TCNSTypeaheadOptions = {
    placeholder: 'filter by neuron…',
    namesOf: c => [...new Set((CNSExplorerReads.topologyOf(c)?.neurons ?? []).map(neuron => neuron.name))].sort(),
    patchOf: name => ({ neuronName: name }),
};
