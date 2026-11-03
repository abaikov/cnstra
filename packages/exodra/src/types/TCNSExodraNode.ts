import type { TExoBaseNodeMethods } from '@exodra/core';
import type { ICNS, TCNSNeuron } from '@cnstra/types';

export type TCNSExodraNode = Pick<TExoBaseNodeMethods, 'inject'> & { readonly cns: ICNS<TCNSNeuron<any>> };
