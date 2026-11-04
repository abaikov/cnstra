import { composeExoMachine, createExoMachine, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import type { TCNSCollateralRow } from '../../types/TCNSCollateralRow';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSListRow } from '../../types/TCNSListRow';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const SHOWN_SUBSCRIBERS = 3;

const collateralRowSchema = exoJsx<{ active: TExoAttrPort; entry: TExoAttrPort; subscribed: TExoAttrPort; rowIndex: TExoAttrPort; open: TExoEventPort; title: TExoTextPort; tag: TExoTextPort; into: TExoTextPort; fires: TExoTextPort; subscribers: TExoTextPort }>($ => (
    <div class="exp-row list-row collateral-row" data-active={$.active} data-entry={$.entry} data-subscribed={$.subscribed} style={$.rowIndex} onClick={$.open}>
        <div class="row-left">
            <div class="row-heading row-heading-tagged">
                <span class="row-title">{$.title}</span>
                <span class="tag collateral-tag">{$.tag}</span>
            </div>
            <div class="collateral-into">{$.into}</div>
        </div>
        <div class="row-right">
            <div class="metric">
                <span class="metric-value collateral-fires">{$.fires}</span>
                <span class="metric-label">fires</span>
            </div>
            <div class="metric">
                <span class="metric-value collateral-subscribers">{$.subscribers}</span>
                <span class="metric-label">subs</span>
            </div>
        </div>
    </div>
));
const CollateralRowPorts = collateralRowSchema.ports;

const collateralRowBase = createExoMachine(collateralRowSchema, {
    createInitialState: (_c: TCNSDevToolsNode, row: TCNSListRow<TCNSCollateralRow>) => ({ row }),
});

function showCollateralRow(c: TExoMachineNodeOf<typeof collateralRowBase>): void {
    const { item, index } = c.state.row;
    const { subscriberNames } = item;
    const more = subscriberNames.length - SHOWN_SUBSCRIBERS;
    c.attr(CollateralRowPorts.active, CNSExplorerReads.queryOf(c).selectedCollateral === item.name);
    c.attr(CollateralRowPorts.entry, item.isEntry);
    c.attr(CollateralRowPorts.subscribed, subscriberNames.length > 0);
    c.attr(CollateralRowPorts.rowIndex, `--row-index:${index}`);
    c.text(CollateralRowPorts.title, item.name);
    c.text(CollateralRowPorts.tag, item.isEntry ? 'entry' : `◦ axon of ${item.owner}`);
    c.text(
        CollateralRowPorts.into,
        subscriberNames.length ? `▸ into ${subscriberNames.slice(0, SHOWN_SUBSCRIBERS).join(' · ')}${more > 0 ? ` +${more}` : ''}` : '▸ no subscribers'
    );
    c.text(CollateralRowPorts.fires, item.fires);
    c.text(CollateralRowPorts.subscribers, item.subscribers);
}

export const collateralRowMachine = composeExoMachine(
    collateralRowBase,
    m => withExoTransitions(m, {
        setRow: (c, row: TCNSListRow<TCNSCollateralRow>) => {
            c.state.row = row;
            showCollateralRow(c);
        },
    }),
    m => withCNSReceptors(m, receptor => {
        receptor(CollateralRowPorts.open, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('collateral', c.state.row.item.name, true));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showCollateralRow(c));
    })
);
