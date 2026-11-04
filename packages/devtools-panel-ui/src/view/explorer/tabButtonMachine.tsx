import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSTabChoice } from '../../types/TCNSTabChoice';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const tabButtonSchema = exoJsx<{ active: TExoAttrPort; label: TExoTextPort; select: TExoEventPort }>($ => (
    <button class="exp-tab" data-active={$.active} onClick={$.select}>{$.label}</button>
));
const TabButtonPorts = tabButtonSchema.ports;

const tabButtonBase = createExoMachine(tabButtonSchema, { createInitialState: (_c: TCNSDevToolsNode, choice: TCNSTabChoice) => choice });

function showTabButton(c: TExoMachineNodeOf<typeof tabButtonBase>): void {
    c.text(TabButtonPorts.label, c.state.label);
    c.attr(TabButtonPorts.active, CNSExplorerReads.queryOf(c).tab === c.state.tab);
}

export const tabButtonMachine = composeExoMachine(
    tabButtonBase,
    m => withCNSReceptors(m, receptor => {
        receptor(TabButtonPorts.select, explorerUiAxon.tabSelected, c => ({ tab: c.state.tab }));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showTabButton(c));
    })
);
