import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const actionFeedbackSchema = exoJsx<{ hidden: TExoAttrPort; failed: TExoAttrPort; text: TExoTextPort }>($ => (
    <div class="exp-scheduled-feedback action-feedback" hidden={$.hidden} data-failed={$.failed}>{$.text}</div>
));
const ActionFeedbackPorts = actionFeedbackSchema.ports;

export const actionFeedbackMachine = composeExoMachine(
    createExoMachine<TCNSDevToolsNode>(actionFeedbackSchema),
    m => withOIMEffects(m, effect => {
        effect(c => {
            const action = CNSExplorerReads.actionFeedbackOf(c);
            const message = action?.error ?? action?.notice ?? null;
            c.attr(ActionFeedbackPorts.hidden, message === null);
            c.attr(ActionFeedbackPorts.failed, !!action?.error);
            c.text(ActionFeedbackPorts.text, message ?? '');
        });
    })
);
