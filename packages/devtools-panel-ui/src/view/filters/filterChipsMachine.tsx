import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoChildrenPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';
import type { TCNSFilterChip } from '../../types/TCNSFilterChip';
import { filterChipMachine } from './filterChipMachine';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const chipsOf = (query: TCNSExplorerQuery): TCNSFilterChip[] => {
    const chips: TCNSFilterChip[] = [];
    if (query.status) chips.push({ label: `status: ${query.status}`, patch: { status: undefined } });
    if (query.neuronName) chips.push({ label: `neuron: ${query.neuronName}`, patch: { neuronName: undefined } });
    if (query.entryCollateralName) chips.push({ label: `collateral: ${query.entryCollateralName}`, patch: { entryCollateralName: undefined } });
    if (query.entryOnly) chips.push({ label: 'entry only', patch: { entryOnly: undefined } });
    if (query.text) chips.push({ label: `"${query.text}"`, patch: { text: undefined } });
    if (query.since !== undefined) chips.push({ label: 'time range', patch: { since: undefined } });
    return chips;
};

const filterChipsSchema = exoJsx<{ chips: TExoChildrenPort }>($ => (
    <div class="exp-filter-chips"><$.chips /></div>
));

const { setChip } = filterChipMachine.transitions;

export const filterChipsMachine = composeExoMachine(
    createExoMachine(filterChipsSchema, {
        createInitialState: (c: TCNSDevToolsNode) => ({
            chips: c.keyedList(filterChipsSchema.ports.chips, (chip: TCNSFilterChip) => chip.label, chip => c.build(filterChipMachine, chip), setChip),
        }),
    }),
    m => withOIMEffects(m, effect => {
        effect(c => c.state.chips.reconcile(chipsOf(CNSExplorerReads.queryOf(c))));
    })
);
