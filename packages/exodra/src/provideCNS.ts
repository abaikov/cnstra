import type { TExoBaseNodeMethods } from '@exodra/core';
import type { ICNS, TCNSNeuron } from '@cnstra/types';
import { CNS_EXODRA_CONTEXT } from './constants/CNS_EXODRA_CONTEXT';

export function provideCNS(node: Pick<TExoBaseNodeMethods, 'provide'>, cns: ICNS<TCNSNeuron<any>>): void {
    node.provide(CNS_EXODRA_CONTEXT, cns);
}
