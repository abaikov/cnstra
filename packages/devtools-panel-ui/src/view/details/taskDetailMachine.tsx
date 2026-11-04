import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import { CNSExplorerAggregate } from '../../model/CNSExplorerAggregate';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSTone } from '../../types/TCNSTone';
import type { TCNSFact } from '../../types/TCNSFact';
import type { TCNSPayloadBlock } from '../../types/TCNSPayloadBlock';
import { CNSTimeFormat } from '../../utils/CNSTimeFormat';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { factMachine } from './factMachine';
import { payloadBlockMachine } from './payloadBlockMachine';
import { CNSTaskKey } from '../../utils/CNSTaskKey';
import { CNSStatusPill } from '../../utils/CNSStatusPill';
import type { TCNSStatusPillPorts } from '../../types/TCNSStatusPillPorts';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const taskDetailSchema = exoJsx<TCNSStatusPillPorts & {
    missingHidden: TExoAttrPort; bodyHidden: TExoAttrPort; tone: TExoAttrPort;
    stage: TExoTextPort; neuron: TExoTextPort; openNeuron: TExoEventPort; facts: TExoChildrenPort; payloads: TExoChildrenPort; errorHidden: TExoAttrPort; error: TExoTextPort;
}>($ => (
    <div class="exp-detail">
        <div class="exp-detail-missing" hidden={$.missingHidden}>Task not found in the current snapshot.</div>
        <div class="exp-task" hidden={$.bodyHidden}>
            <div class="exp-task-head">
                <div class="exp-heading eyebrow" data-tone={$.tone}>ACTIVATION TASK</div>
                <span class="status-pill" data-status={$.pillStatus}>
                    <span class="exp-status-dot" />
                    <span>{$.pillText}</span>
                </span>
                <span class="exp-task-stage">{$.stage}</span>
            </div>
            <button class="exp-open-neuron" title="Open the neuron screen" data-tone="violet" onClick={$.openNeuron}>{$.neuron}</button>
            <div class="exp-task-facts"><$.facts /></div>
            <div class="exp-task-payloads"><$.payloads /></div>
            <div class="exp-task-error" hidden={$.errorHidden}>{$.error}</div>
        </div>
    </div>
));
const TaskDetailPorts = taskDetailSchema.ports;

const { setFact } = factMachine.transitions;
const { setPayloadBlock } = payloadBlockMachine.transitions;

const taskDetailBase = createExoMachine(taskDetailSchema, {
    createInitialState: (c: TCNSDevToolsNode, taskKey: string) => ({
        taskKey,
        neuronName: '',
        facts: c.keyedList(TaskDetailPorts.facts, (fact: TCNSFact) => fact.label, fact => c.build(factMachine, fact), setFact),
        payloads: c.keyedList(TaskDetailPorts.payloads, (block: TCNSPayloadBlock) => block.label, block => c.build(payloadBlockMachine, block), setPayloadBlock),
    }),
});

function showTaskDetail(c: TExoMachineNodeOf<typeof taskDetailBase>): void {
    const { taskKey, facts, payloads } = c.state;
    const detail = CNSExplorerReads.detailOf(c, CNSTaskKey.stimulationIdOfKey(taskKey));
    const snapshot = { stimulations: [], attempts: detail?.attempts ?? [], tasks: detail?.tasks ?? [] };
    const raw = snapshot.tasks.find(candidate => CNSTaskKey.of(candidate) === taskKey);
    const task = CNSExplorerAggregate.taskRows(snapshot).find(row => row.key === taskKey);
    const isFound = raw !== undefined && task !== undefined;
    c.attr(TaskDetailPorts.missingHidden, isFound || detail === undefined);
    c.attr(TaskDetailPorts.bodyHidden, !isFound);
    if (raw === undefined || task === undefined) return;
    c.state.neuronName = task.neuronName;
    const tone: TCNSTone = raw.status === 'failed' ? 'red' : 'green';
    const stage = CNSTaskKey.stageOf(raw.index);
    c.attr(TaskDetailPorts.tone, tone);
    CNSStatusPill.show(c, TaskDetailPorts, raw.status);
    c.text(TaskDetailPorts.stage, `stage ${stage}`);
    c.text(TaskDetailPorts.neuron, `▪ ${task.neuronName} ›`);
    facts.reconcile([
        { label: 'stage', value: `#${stage}`, tone },
        { label: 'input collateral', value: `◦ ${task.input}`, tone: 'cyan' },
        { label: 'output collateral', value: task.output ? `◦ ${task.output}` : 'no output', tone: task.output ? 'cyan' : 'muted' },
        { label: 'attempt', value: `#${task.attemptNumber}`, tone: 'violet' },
        { label: 'duration', value: task.duration !== null ? `${task.duration}ms` : '—', tone: 'text' },
        { label: 'started', value: CNSTimeFormat.timeOf(task.startedAt), tone: 'muted' },
        { label: 'run', value: `⚡ ${task.stimulationId}`, tone: 'yellow', opens: { kind: 'stimulation', id: task.stimulationId } },
    ]);
    const producer = snapshot.tasks
        .filter(candidate => candidate.stimulationAttemptId === raw.stimulationAttemptId && candidate.index < raw.index && candidate.output?.collateralName === raw.dendriteCollateralName)
        .sort((left, right) => right.index - left.index)[0];
    const entrySignal = snapshot.attempts.flatMap(attempt => attempt.entry).find(signal => signal.collateralName === raw.dendriteCollateralName);
    const input = producer?.output ?? entrySignal;
    payloads.reconcile([
        ...(raw.activationContext ? [{ label: 'activation context', payload: raw.activationContext, isPresent: true, tone: 'violet' } satisfies TCNSPayloadBlock] : []),
        { label: `◦ ${task.input} — input signal payload`, payload: input?.payload, isPresent: input !== undefined, tone: 'cyan' },
        { label: task.output ? `◦ ${task.output} — output signal payload` : 'output signal — no output', payload: raw.output?.payload, isPresent: raw.output !== null, tone: 'green' },
    ]);
    c.attr(TaskDetailPorts.errorHidden, !task.error);
    c.text(TaskDetailPorts.error, `⌐ ${task.error ?? ''}`);
}

export const taskDetailMachine = composeExoMachine(
    taskDetailBase,
    m => withCNSReceptors(m, receptor => {
        receptor(TaskDetailPorts.openNeuron, explorerUiAxon.entityOpened, c => (c.state.neuronName ? CNSEntityOpening.of('neuron', c.state.neuronName, false) : undefined));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showTaskDetail(c));
    })
);
