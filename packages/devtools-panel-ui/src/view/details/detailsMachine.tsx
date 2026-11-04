import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoChildrenPort, TExoMachineNodeOf } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { collateralDetailMachine } from './collateralDetailMachine';
import { hintMachine } from './hintMachine';
import { neuronDetailMachine } from './neuronDetailMachine';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { CNSChildSwitch } from '../../utils/CNSChildSwitch';
import type { TCNSShownChild } from '../../types/TCNSShownChild';
import { stimulationDetailMachine } from './stimulationDetailMachine';
import { taskDetailMachine } from './taskDetailMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const detailsSchema = exoJsx<{ content: TExoChildrenPort }>($ => (
    <div class="exp-details"><$.content /></div>
));

const detailsBase = createExoMachine(detailsSchema, {
    createInitialState: (c: TCNSDevToolsNode) => {
        const shown: { current: TCNSShownChild | undefined } = { current: undefined };
        return { content: c.childList(detailsSchema.ports.content), shown };
    },
});

function showDetails(c: TExoMachineNodeOf<typeof detailsBase>): void {
    const query = CNSExplorerReads.queryOf(c);
    const { content, shown } = c.state;
    if (query.selected) CNSChildSwitch.show(c, content, shown, stimulationDetailMachine, query.selected, query.selected);
    else if (query.selectedNeuron) CNSChildSwitch.show(c, content, shown, neuronDetailMachine, query.selectedNeuron, query.selectedNeuron);
    else if (query.selectedCollateral) CNSChildSwitch.show(c, content, shown, collateralDetailMachine, query.selectedCollateral, query.selectedCollateral);
    else if (query.selectedTask) CNSChildSwitch.show(c, content, shown, taskDetailMachine, query.selectedTask, query.selectedTask);
    else CNSChildSwitch.show(c, content, shown, hintMachine, undefined, null);
}

export const detailsMachine = composeExoMachine(
    detailsBase,
    m => withOIMEffects(m, effect => {
        effect(c => showDetails(c));
    })
);
