import type { TExoMachine } from '@exodra/core';
import type { TExoChildList, TExoDomNode } from '@exodra/dom';
import type { TCNSShownChild } from '../types/TCNSShownChild';

export class CNSChildSwitch {
    public static show<TNode extends TExoDomNode, TParams>(
        c: TNode,
        children: TExoChildList,
        shown: { current: TCNSShownChild | undefined },
        machine: TExoMachine<TNode, unknown, TParams>,
        params: TParams,
        key: unknown
    ): void {
        if (shown.current !== undefined && shown.current.machine === machine && shown.current.key === key) return;
        shown.current = { machine, key };
        children.removeAll();
        children.insert(c.build(machine, params), 0);
    }
}
