import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSFilterChip } from '../../types/TCNSFilterChip';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const filterChipSchema = exoJsx<{ label: TExoTextPort; clear: TExoEventPort }>($ => (
    <button class="exp-filter-chip" onClick={$.clear}>{$.label}</button>
));
const FilterChipPorts = filterChipSchema.ports;

const filterChipBase = createExoMachine(filterChipSchema, { createInitialState: (_c: TCNSDevToolsNode, chip: TCNSFilterChip) => ({ chip }) });

function showFilterChip(c: TExoMachineNodeOf<typeof filterChipBase>): void {
    c.text(FilterChipPorts.label, `${c.state.chip.label} ✕`);
}

export const filterChipMachine = composeExoMachine(
    filterChipBase,
    m => withExoTransitions(m, {
        setChip: (c, chip: TCNSFilterChip) => {
            c.state.chip = chip;
            showFilterChip(c);
        },
    }),
    m => withExoWire(m, c => showFilterChip(c)),
    m => withCNSReceptors(m, receptor => {
        receptor(FilterChipPorts.clear, explorerUiAxon.queryPatched, c => ({ patch: c.state.chip.patch }));
    })
);
