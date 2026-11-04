import type { CNSHomeostatReceptor } from '@cnstra/sync';
import type { TCNSDevToolsSyncData, TCNSDevToolsSyncKeys, TCNSDevToolsSyncReceptorName } from '@cnstra/devtools-dto';

export type TCNSDevToolsReceptors = {
    readonly [TName in TCNSDevToolsSyncReceptorName]: CNSHomeostatReceptor<TCNSDevToolsSyncKeys[TName], TCNSDevToolsSyncData[TName]>;
};
