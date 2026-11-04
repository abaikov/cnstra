import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const typeaheadItemSchema = exoJsx<{ name: TExoAttrPort; label: TExoTextPort }>($ => (
    <div class="exp-ta-item" data-name={$.name}>{$.label}</div>
));
const TypeaheadItemPorts = typeaheadItemSchema.ports;

const typeaheadItemBase = createExoMachine(typeaheadItemSchema, { createInitialState: (_c: TCNSDevToolsNode, name: string) => ({ name }) });

function showTypeaheadItem(c: TExoMachineNodeOf<typeof typeaheadItemBase>): void {
    c.attr(TypeaheadItemPorts.name, c.state.name);
    c.text(TypeaheadItemPorts.label, c.state.name);
}

export const typeaheadItemMachine = composeExoMachine(
    typeaheadItemBase,
    m => withExoTransitions(m, {
        setName: (c, name: string) => {
            c.state.name = name;
            showTypeaheadItem(c);
        },
    }),
    m => withExoWire(m, c => showTypeaheadItem(c))
);
