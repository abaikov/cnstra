import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSSelectOption } from '../../types/TCNSSelectOption';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const selectOptionSchema = exoJsx<{ value: TExoAttrPort; label: TExoTextPort }>($ => <option value={$.value}>{$.label}</option>);
const SelectOptionPorts = selectOptionSchema.ports;

const selectOptionBase = createExoMachine(selectOptionSchema, {
    createInitialState: (_c: TCNSDevToolsNode, option: TCNSSelectOption) => ({ option }),
});

function showSelectOption(c: TExoMachineNodeOf<typeof selectOptionBase>): void {
    c.attr(SelectOptionPorts.value, c.state.option.value);
    c.text(SelectOptionPorts.label, c.state.option.label);
}

export const selectOptionMachine = composeExoMachine(
    selectOptionBase,
    m => withExoTransitions(m, {
        setOption: (c, option: TCNSSelectOption) => {
            c.state.option = option;
            showSelectOption(c);
        },
    }),
    m => withExoWire(m, c => showSelectOption(c))
);
