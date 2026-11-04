import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const entryToggleSchema = exoJsx<{ active: TExoAttrPort; toggle: TExoEventPort }>($ => (
    <button class="exp-toggle exp-entry-toggle" data-tone="pink" title="Show only entry collaterals (owner-less)" data-active={$.active} onClick={$.toggle}>
        <span class="exp-entry-toggle-box" />
        <span>entry collaterals only</span>
    </button>
));
const EntryTogglePorts = entryToggleSchema.ports;

export const entryToggleMachine = composeExoMachine(
    createExoMachine<TCNSDevToolsNode>(entryToggleSchema),
    m => withCNSReceptors(m, receptor => {
        receptor(EntryTogglePorts.toggle, explorerUiAxon.queryPatched, c => ({ patch: { entryOnly: CNSExplorerReads.queryOf(c).entryOnly ? undefined : true } }));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => {
            c.attr(EntryTogglePorts.active, CNSExplorerReads.queryOf(c).entryOnly === true);
        });
    })
);
