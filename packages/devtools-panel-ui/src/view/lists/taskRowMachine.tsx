import { composeExoMachine, createExoMachine, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import type { TCNSTaskRow } from '../../types/TCNSTaskRow';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSListRow } from '../../types/TCNSListRow';
import type { TCNSStatusPillPorts } from '../../types/TCNSStatusPillPorts';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { CNSStatusPill } from '../../utils/CNSStatusPill';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const taskRowSchema = exoJsx<TCNSStatusPillPorts & { active: TExoAttrPort; status: TExoAttrPort; failed: TExoAttrPort; rowIndex: TExoAttrPort; open: TExoEventPort; title: TExoTextPort; subtitle: TExoTextPort; stimulationId: TExoTextPort }>($ => (
    <div class="exp-row list-row task-row" data-active={$.active} data-status={$.status} data-failed={$.failed} style={$.rowIndex} onClick={$.open}>
        <div class="row-left">
            <div class="row-heading">
                <span class="row-title">{$.title}</span>
                <span class="row-sub">{$.subtitle}</span>
            </div>
        </div>
        <div class="row-right">
            <span class="row-note task-stimulation">{$.stimulationId}</span>
            <span class="status-pill" data-status={$.pillStatus}>
                <span class="exp-status-dot" />
                <span>{$.pillText}</span>
            </span>
        </div>
    </div>
));
const TaskRowPorts = taskRowSchema.ports;

const taskRowBase = createExoMachine(taskRowSchema, {
    createInitialState: (_c: TCNSDevToolsNode, row: TCNSListRow<TCNSTaskRow>) => ({ row }),
});

function showTaskRow(c: TExoMachineNodeOf<typeof taskRowBase>): void {
    const { item, index } = c.state.row;
    c.attr(TaskRowPorts.active, CNSExplorerReads.queryOf(c).selectedTask === item.key);
    c.attr(TaskRowPorts.status, item.status);
    c.attr(TaskRowPorts.failed, item.error !== null);
    c.attr(TaskRowPorts.rowIndex, `--row-index:${index}`);
    c.text(TaskRowPorts.title, item.neuronName);
    c.text(TaskRowPorts.subtitle, `${item.input} → ${item.output ?? 'no output'}`);
    c.text(TaskRowPorts.stimulationId, item.stimulationId);
    CNSStatusPill.show(c, TaskRowPorts, item.status);
}

export const taskRowMachine = composeExoMachine(
    taskRowBase,
    m => withExoTransitions(m, {
        setRow: (c, row: TCNSListRow<TCNSTaskRow>) => {
            c.state.row = row;
            showTaskRow(c);
        },
    }),
    m => withCNSReceptors(m, receptor => {
        receptor(TaskRowPorts.open, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('task', c.state.row.item.key, true));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showTaskRow(c));
    })
);
