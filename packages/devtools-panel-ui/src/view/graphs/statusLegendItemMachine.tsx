import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSStatusShare } from '../../types/TCNSStatusShare';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const statusLegendItemSchema = exoJsx<{ status: TExoAttrPort; label: TExoTextPort; count: TExoTextPort }>($ => (
    <span class="legend-item">
        <span class="legend-swatch" data-status={$.status} />
        <span>{$.label}</span>
        <span class="legend-count">{$.count}</span>
    </span>
));
const StatusLegendItemPorts = statusLegendItemSchema.ports;

const statusLegendItemBase = createExoMachine(statusLegendItemSchema, { createInitialState: (_c: TCNSDevToolsNode, share: TCNSStatusShare) => ({ share }) });

function showStatusLegendItem(c: TExoMachineNodeOf<typeof statusLegendItemBase>): void {
    const { share } = c.state;
    c.attr(StatusLegendItemPorts.status, share.status);
    c.text(StatusLegendItemPorts.label, share.status);
    c.text(StatusLegendItemPorts.count, share.count);
}

export const statusLegendItemMachine = composeExoMachine(
    statusLegendItemBase,
    m => withExoTransitions(m, {
        setStatusShare: (c, share: TCNSStatusShare) => {
            c.state.share = share;
            showStatusLegendItem(c);
        },
    }),
    m => withExoWire(m, c => showStatusLegendItem(c))
);
