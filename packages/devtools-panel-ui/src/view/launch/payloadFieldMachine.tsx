import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TExoKeyedList } from '@exodra/list-reconcile';
import type { TCNSPayloadField } from '../../types/TCNSPayloadField';
import type { TCNSSelectOption } from '../../types/TCNSSelectOption';
import { selectOptionMachine } from './selectOptionMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const payloadFieldSchema = exoJsx<{
    label: TExoTextPort; textName: TExoAttrPort; placeholder: TExoAttrPort; textHidden: TExoAttrPort; checkName: TExoAttrPort; checkHidden: TExoAttrPort;
    selectName: TExoAttrPort; selectHidden: TExoAttrPort; options: TExoChildrenPort;
}>($ => (
    <label class="payload-field">
        <span class="payload-field-label">{$.label}</span>
        <input class="form-control payload-field-control" name={$.textName} placeholder={$.placeholder} hidden={$.textHidden} />
        <input type="checkbox" name={$.checkName} hidden={$.checkHidden} />
        <select class="form-control payload-field-control" name={$.selectName} hidden={$.selectHidden}><$.options /></select>
    </label>
));
const PayloadFieldPorts = payloadFieldSchema.ports;

const { setOption } = selectOptionMachine.transitions;

type TCNSPayloadFieldState = { field: TCNSPayloadField; options: TExoKeyedList<TCNSSelectOption> };

const payloadFieldBase = createExoMachine(payloadFieldSchema, {
    createInitialState: (c: TCNSDevToolsNode, field: TCNSPayloadField): TCNSPayloadFieldState => ({
        field,
        options: c.keyedList(PayloadFieldPorts.options, (option: TCNSSelectOption) => option.value, option => c.build(selectOptionMachine, option), setOption),
    }),
});

function showPayloadField(c: TExoMachineNodeOf<typeof payloadFieldBase>): void {
    const { field, options } = c.state;
    const isCheck = field.kind === 'boolean';
    const isSelect = !isCheck && field.options !== undefined;
    const isText = !isCheck && !isSelect;
    c.text(PayloadFieldPorts.label, `${field.name}${field.required ? ' *' : ''}`);
    c.attr(PayloadFieldPorts.textHidden, !isText);
    c.attr(PayloadFieldPorts.checkHidden, !isCheck);
    c.attr(PayloadFieldPorts.selectHidden, !isSelect);
    c.attr(PayloadFieldPorts.textName, isText ? field.name : null);
    c.attr(PayloadFieldPorts.checkName, isCheck ? field.name : null);
    c.attr(PayloadFieldPorts.selectName, isSelect ? field.name : null);
    c.attr(PayloadFieldPorts.placeholder, field.kind);
    options.reconcile(['', ...(field.options ?? [])].map(value => ({ value, label: value || '—' })));
}

export const payloadFieldMachine = composeExoMachine(
    payloadFieldBase,
    m => withExoTransitions(m, {
        setField: (c, field: TCNSPayloadField) => {
            c.state.field = field;
            showPayloadField(c);
        },
    }),
    m => withExoWire(m, c => showPayloadField(c))
);
