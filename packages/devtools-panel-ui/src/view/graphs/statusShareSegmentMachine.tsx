import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSStatusShare } from '../../types/TCNSStatusShare';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const statusShareSegmentSchema = exoJsx<{ status: TExoAttrPort; x: TExoAttrPort; width: TExoAttrPort; title: TExoTextPort }>($ => (
    <rect data-status={$.status} y="0" height="1" x={$.x} width={$.width}>
        <title>{$.title}</title>
    </rect>
));
const StatusShareSegmentPorts = statusShareSegmentSchema.ports;

const statusShareSegmentBase = createExoMachine(statusShareSegmentSchema, { createInitialState: (_c: TCNSDevToolsNode, share: TCNSStatusShare) => ({ share }) });

function showStatusShareSegment(c: TExoMachineNodeOf<typeof statusShareSegmentBase>): void {
    const { share } = c.state;
    c.attr(StatusShareSegmentPorts.status, share.status);
    c.attr(StatusShareSegmentPorts.x, share.offsetPercent.toFixed(2));
    c.attr(StatusShareSegmentPorts.width, share.sharePercent.toFixed(2));
    c.text(StatusShareSegmentPorts.title, `${share.status}: ${share.count}`);
}

export const statusShareSegmentMachine = composeExoMachine(
    statusShareSegmentBase,
    m => withExoTransitions(m, {
        setStatusShare: (c, share: TCNSStatusShare) => {
            c.state.share = share;
            showStatusShareSegment(c);
        },
    }),
    m => withExoWire(m, c => showStatusShareSegment(c))
);
