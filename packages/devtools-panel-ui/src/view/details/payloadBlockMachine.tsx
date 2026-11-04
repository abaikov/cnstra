import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSPayloadBlock } from '../../types/TCNSPayloadBlock';
import { CNSPayloadPreview } from '../../utils/CNSPayloadPreview';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const payloadBlockSchema = exoJsx<{ labelTone: TExoAttrPort; label: TExoTextPort; bodyTone: TExoAttrPort; body: TExoTextPort }>($ => (
    <div class="exp-payload-block">
        <span class="exp-payload-block-label" data-tone={$.labelTone}>{$.label}</span>
        <code class="exp-payload-block-body" data-tone={$.bodyTone}>{$.body}</code>
    </div>
));
const PayloadBlockPorts = payloadBlockSchema.ports;

const payloadBlockBase = createExoMachine(payloadBlockSchema, { createInitialState: (_c: TCNSDevToolsNode, block: TCNSPayloadBlock) => ({ block }) });

function showPayloadBlock(c: TExoMachineNodeOf<typeof payloadBlockBase>): void {
    const { block } = c.state;
    c.attr(PayloadBlockPorts.labelTone, block.tone);
    c.text(PayloadBlockPorts.label, block.label);
    c.attr(PayloadBlockPorts.bodyTone, block.isPresent ? 'sub' : 'muted');
    c.text(PayloadBlockPorts.body, block.isPresent ? CNSPayloadPreview.textOf(block.payload, 2000, true) : '— not in the loaded snapshot —');
}

export const payloadBlockMachine = composeExoMachine(
    payloadBlockBase,
    m => withExoTransitions(m, {
        setPayloadBlock: (c, block: TCNSPayloadBlock) => {
            c.state.block = block;
            showPayloadBlock(c);
        },
    }),
    m => withExoWire(m, c => showPayloadBlock(c))
);
