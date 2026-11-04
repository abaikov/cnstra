import type { TExoDomNode } from '@exodra/dom';
import type { TExoKeyedListApi } from '@exodra/list-reconcile';
import type { OIMExodraPlugin } from '@oimdb/exodra';
import type { TCNSDevTools } from '../model/types/TCNSDevTools';

export type TCNSDevToolsNode = TExoDomNode & TExoKeyedListApi & {
    readonly devTools: TCNSDevTools;
    readonly cns: TCNSDevTools['cns'];
    readonly exodraPlugin: OIMExodraPlugin;
};
