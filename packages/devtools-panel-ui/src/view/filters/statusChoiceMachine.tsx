import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSStatusChoice } from '../../types/TCNSStatusChoice';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const statusChoiceSchema = exoJsx<{ tone: TExoAttrPort; active: TExoAttrPort; label: TExoTextPort; count: TExoTextPort; select: TExoEventPort }>($ => (
    <button class="exp-toggle exp-status-choice" data-tone={$.tone} data-active={$.active} onClick={$.select}>
        <span class="exp-tone-dot" />
        <span>{$.label}</span>
        <span class="exp-status-choice-count">{$.count}</span>
    </button>
));
const StatusChoicePorts = statusChoiceSchema.ports;

const statusChoiceBase = createExoMachine(statusChoiceSchema, { createInitialState: (_c: TCNSDevToolsNode, choice: TCNSStatusChoice) => choice });

function showStatusChoice(c: TExoMachineNodeOf<typeof statusChoiceBase>): void {
    const { status, label, tone } = c.state;
    const byStatus = CNSExplorerReads.facetsOf(c)?.byStatus ?? [];
    c.text(StatusChoicePorts.label, label);
    c.text(StatusChoicePorts.count, status === undefined ? byStatus.reduce((sum, bucket) => sum + bucket.count, 0) : byStatus.find(bucket => bucket.status === status)?.count ?? 0);
    c.attr(StatusChoicePorts.tone, tone);
    c.attr(StatusChoicePorts.active, CNSExplorerReads.queryOf(c).status === status);
}

export const statusChoiceMachine = composeExoMachine(
    statusChoiceBase,
    m => withCNSReceptors(m, receptor => {
        receptor(StatusChoicePorts.select, explorerUiAxon.queryPatched, c => ({ patch: { status: c.state.status } }));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showStatusChoice(c));
    })
);
