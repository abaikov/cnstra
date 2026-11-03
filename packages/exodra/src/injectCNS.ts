import type { ICNS, TCNSNeuron } from '@cnstra/types';
import type { TCNSExodraNode } from './types/TCNSExodraNode';
import { CNS_EXODRA_CONTEXT } from './constants/CNS_EXODRA_CONTEXT';

export function injectCNS(node: TCNSExodraNode): ICNS<TCNSNeuron<any>> {
    const cns = node.inject(CNS_EXODRA_CONTEXT) ?? node.cns;
    if (cns === undefined) {
        throw new Error('injectCNS: no CNS for this node: register `cns: () => cns` in composeExoPlugins, or call provideCNS(node, cns) in the wiring of a node above it.');
    }
    return cns;
}
