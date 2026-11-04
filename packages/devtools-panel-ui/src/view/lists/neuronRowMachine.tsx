import { composeExoMachine, createExoMachine, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import type { TCNSNeuronRow } from '../../types/TCNSNeuronRow';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSListRow } from '../../types/TCNSListRow';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const neuronRowSchema = exoJsx<{ active: TExoAttrPort; failing: TExoAttrPort; rowIndex: TExoAttrPort; open: TExoEventPort; title: TExoTextPort; subtitle: TExoTextPort; throughput: TExoTextPort; errors: TExoTextPort }>($ => (
    <div class="exp-row list-row neuron-row" data-active={$.active} data-failing={$.failing} style={$.rowIndex} onClick={$.open}>
        <div class="row-left">
            <div class="row-heading">
                <span class="row-title">{$.title}</span>
                <span class="row-sub">{$.subtitle}</span>
            </div>
        </div>
        <div class="row-right">
            <div class="metric">
                <span class="metric-value neuron-throughput">{$.throughput}</span>
                <span class="metric-label">thru</span>
            </div>
            <div class="metric">
                <span class="metric-value neuron-errors">{$.errors}</span>
                <span class="metric-label">err</span>
            </div>
        </div>
    </div>
));
const NeuronRowPorts = neuronRowSchema.ports;

const neuronRowBase = createExoMachine(neuronRowSchema, {
    createInitialState: (_c: TCNSDevToolsNode, row: TCNSListRow<TCNSNeuronRow>) => ({ row }),
});

function showNeuronRow(c: TExoMachineNodeOf<typeof neuronRowBase>): void {
    const { item, index } = c.state.row;
    c.attr(NeuronRowPorts.active, CNSExplorerReads.queryOf(c).selectedNeuron === item.name);
    c.attr(NeuronRowPorts.failing, item.errors > 0);
    c.attr(NeuronRowPorts.rowIndex, `--row-index:${index}`);
    c.text(NeuronRowPorts.title, item.name);
    c.text(NeuronRowPorts.subtitle, `${item.dendrites} in · ${item.axons} out`);
    c.text(NeuronRowPorts.throughput, item.throughput);
    c.text(NeuronRowPorts.errors, item.errors);
}

export const neuronRowMachine = composeExoMachine(
    neuronRowBase,
    m => withExoTransitions(m, {
        setRow: (c, row: TCNSListRow<TCNSNeuronRow>) => {
            c.state.row = row;
            showNeuronRow(c);
        },
    }),
    m => withCNSReceptors(m, receptor => {
        receptor(NeuronRowPorts.open, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('neuron', c.state.row.item.name, true));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showNeuronRow(c));
    })
);
