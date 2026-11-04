import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withCNSReceptors } from '@cnstra/exodra';
import type { TCNSTaskRow } from '../../types/TCNSTaskRow';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { CNSTaskKey } from '../../utils/CNSTaskKey';
import { CNSStatusPill } from '../../utils/CNSStatusPill';
import type { TCNSStatusPillPorts } from '../../types/TCNSStatusPillPorts';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const activationSchema = exoJsx<TCNSStatusPillPorts & { tone: TExoAttrPort; open: TExoEventPort; stage: TExoTextPort; flow: TExoTextPort; stimulationId: TExoTextPort }>($ => (
    <div class="exp-act-row exp-detail-row" title="Open this activation task" data-tone={$.tone} onClick={$.open}>
        <span class="exp-tag">{$.stage}</span>
        <span class="exp-detail-row-flow">{$.flow}</span>
        <div class="exp-spacer" />
        <span class="exp-detail-row-stimulation">{$.stimulationId}</span>
        <span class="status-pill" data-status={$.pillStatus}>
            <span class="exp-status-dot" />
            <span>{$.pillText}</span>
        </span>
    </div>
));
const ActivationPorts = activationSchema.ports;

const activationBase = createExoMachine(activationSchema, { createInitialState: (_c: TCNSDevToolsNode, task: TCNSTaskRow) => ({ task }) });

function showActivation(c: TExoMachineNodeOf<typeof activationBase>): void {
    const { task } = c.state;
    const stage = CNSTaskKey.stageOfKey(task.key);
    c.attr(ActivationPorts.tone, task.error ? 'red' : 'green');
    c.text(ActivationPorts.stage, stage === null ? 'task' : `stage ${stage}`);
    c.text(ActivationPorts.flow, `◦ ${task.input} → ${task.output ? `◦ ${task.output}` : 'no output'}`);
    c.text(ActivationPorts.stimulationId, `⚡ ${task.stimulationId}`);
    CNSStatusPill.show(c, ActivationPorts, task.status);
}

export const activationMachine = composeExoMachine(
    activationBase,
    m => withExoTransitions(m, {
        setActivation: (c, task: TCNSTaskRow) => {
            c.state.task = task;
            showActivation(c);
        },
    }),
    m => withExoWire(m, c => showActivation(c)),
    m => withCNSReceptors(m, receptor => {
        receptor(ActivationPorts.open, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('task', c.state.task.key, false));
    })
);
