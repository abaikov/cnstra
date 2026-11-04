import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoMachineNodeOf } from '@exodra/core';
import { withOIMEffects } from '@oimdb/exodra';
import { CNSExplorerAggregate } from '../../model/CNSExplorerAggregate';
import type { TCNSTaskRow } from '../../types/TCNSTaskRow';
import type { TCNSDiagramTarget } from '../../types/TCNSDiagramTarget';
import { activationMachine } from './activationMachine';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { EMPTY_EXPLORER_TOPOLOGY } from '../../constants/EMPTY_EXPLORER_TOPOLOGY';
import { EMPTY_STIMULATION_FACETS } from '../../constants/EMPTY_STIMULATION_FACETS';
import { scheduledSectionMachine } from '../scheduled/scheduledSectionMachine';
import { scopeCardMachine } from './scopeCardMachine';
import { scopeDetailSchema } from './scopeDetailSchema';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const NEURON_ACTIVATIONS_SHOWN = 60;

const ScopeDetailPorts = scopeDetailSchema.ports;

const { setActivation } = activationMachine.transitions;
const { setScope } = scopeCardMachine.transitions;

const collateralTarget = (collateralName: string, role: string, count: number, error: number): TCNSDiagramTarget => ({
    id: collateralName,
    kind: 'collateral',
    title: collateralName,
    sub: count > 0 ? `${role} · ${count}${error ? ` · ${error} err` : ''}` : `${role} · no traffic`,
    weight: count,
    status: error > 0 ? 'failed' : count > 0 ? 'completed' : 'idle',
    opens: { kind: 'collateral', id: collateralName },
});

const neuronDetailBase = createExoMachine(scopeDetailSchema, {
    createInitialState: (c: TCNSDevToolsNode, name: string) => {
        c.one(ScopeDetailPorts.scheduled, scheduledSectionMachine, { filter: { neuronName: name }, where: 'at this neuron' });
        return {
            name,
            card: c.one(ScopeDetailPorts.card, scopeCardMachine),
            rows: c.keyedList(ScopeDetailPorts.rows, (task: TCNSTaskRow) => task.key, task => c.build(activationMachine, task), setActivation),
        };
    },
});

function showNeuronDetail(c: TExoMachineNodeOf<typeof neuronDetailBase>): void {
    const { name, card, rows } = c.state;
    const query = CNSExplorerReads.queryOf(c);
    const topology = CNSExplorerReads.topologyOf(c, query) ?? EMPTY_EXPLORER_TOPOLOGY;
    const snapshot = CNSExplorerReads.neuronSnapshotOf(c, name);
    const detail = CNSExplorerAggregate.neuronDetail(name, topology, snapshot, CNSExplorerReads.facetsOf(c, query) ?? EMPTY_STIMULATION_FACETS);
    const errorRate = detail.throughput ? detail.errors / detail.throughput : 0;
    setScope(card, {
        eyebrow: 'NEURON · SCOPE',
        tone: 'violet',
        title: name,
        description: 'A NEURON (violet box). It reacts to its INPUT collaterals (via dendrites, left) and emits its OUTPUT collaterals (via its axon, right). Every side node is a collateral — click one to open it.',
        stat: detail.throughput,
        statLabel: 'throughput',
        isEntry: false,
        facts: [
            { label: 'input collaterals', value: String(detail.dendrites.length), tone: 'cyan' },
            { label: 'output collaterals', value: String(detail.axons.length), tone: 'cyan' },
            { label: 'errors', value: String(detail.errors), tone: detail.errors ? 'red' : 'muted' },
        ],
        ratio: { value: errorRate, caption: `error rate — ${(errorRate * 100).toFixed(1)}%`, tone: errorRate > 0 ? 'red' : 'green' },
        diagram: {
            sourceKind: 'neuron',
            sourceLabel: name,
            leftHeading: 'INPUTS ▸ (via dendrites)',
            rightHeading: '(via axon) ◂ OUTPUTS',
            left: detail.dendrites.map(input => collateralTarget(input.collateralName, 'input', input.count, input.error)),
            right: detail.axons.map(output => collateralTarget(output.collateralName, 'output', output.count, output.error)),
        },
    });
    const activations = CNSExplorerAggregate.taskRows(snapshot).filter(task => task.neuronName === name);
    const runs = new Set(activations.map(task => task.stimulationId)).size;
    c.attr(ScopeDetailPorts.headingTone, 'violet');
    c.text(ScopeDetailPorts.heading, 'Activations');
    c.text(
        ScopeDetailPorts.caption,
        activations.length
            ? `${activations.length} task${activations.length === 1 ? '' : 's'} · ${runs} run${runs === 1 ? '' : 's'}${activations.length > NEURON_ACTIVATIONS_SHOWN ? ` · showing newest ${NEURON_ACTIVATIONS_SHOWN}` : ''} · click a row to open the task`
            : ''
    );
    c.attr(ScopeDetailPorts.emptyHidden, activations.length > 0);
    c.text(ScopeDetailPorts.empty, 'No activations of this neuron in the loaded snapshot yet.');
    rows.reconcile(activations.slice(0, NEURON_ACTIVATIONS_SHOWN));
}

export const neuronDetailMachine = composeExoMachine(
    neuronDetailBase,
    m => withOIMEffects(m, effect => {
        effect(c => showNeuronDetail(c));
    })
);
