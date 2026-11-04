import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import type { ICNS, TCNSNeuron } from '@cnstra/types';

export type TCNSDevToolsSource = {
    cns: ICNS<TCNSNeuron<any>>;
    registry: CNSPersistOptionsRegistry;
    actions?(): TCNSDevToolsActionMiddleware;
};
