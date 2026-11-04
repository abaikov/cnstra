import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoRefPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TExoKeyedList } from '@exodra/list-reconcile';
import { withOIMEffects } from '@oimdb/exodra';
import { injectCNS } from '@cnstra/exodra';
import { CNSPayloadForm } from './CNSPayloadForm';
import type { TCNSPayloadField } from '../../types/TCNSPayloadField';
import type { TCNSSelectOption } from '../../types/TCNSSelectOption';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { payloadFieldMachine } from './payloadFieldMachine';
import { selectOptionMachine } from './selectOptionMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const { setOption } = selectOptionMachine.transitions;
const { setField } = payloadFieldMachine.transitions;

const launchFormSchema = exoJsx<{
    hidden: TExoAttrPort; openHidden: TExoAttrPort; open: TExoEventPort; formHidden: TExoAttrPort; type: TExoRefPort<HTMLSelectElement>; options: TExoChildrenPort; typeChanged: TExoEventPort; close: TExoEventPort;
    descriptionHidden: TExoAttrPort; description: TExoTextPort; fieldInput: TExoEventPort<Event>; fields: TExoChildrenPort; json: TExoRefPort<HTMLTextAreaElement>; jsonHidden: TExoAttrPort; submit: TExoEventPort;
}>($ => (
    <div class="launch" hidden={$.hidden}>
        <div class="launch-bar" hidden={$.openHidden}>
            <button class="launch-open" title="Enqueue a job" onClick={$.open}>+ Enqueue a job</button>
        </div>
        <div class="exp-launch-form launch-form" hidden={$.formHidden}>
            <div class="launch-form-head">
                <div class="exp-heading launch-form-heading">Enqueue</div>
                <select class="form-control launch-form-type" name="collateral" ref={$.type} onChange={$.typeChanged}><$.options /></select>
                <button class="exp-command command launch-form-close" title="Close" onClick={$.close}>✕</button>
            </div>
            <div class="launch-form-description" hidden={$.descriptionHidden}>{$.description}</div>
            <div class="launch-form-fields" on:input={$.fieldInput}><$.fields /></div>
            <textarea class="form-control launch-form-json" name="payload" rows={3} ref={$.json} hidden={$.jsonHidden} />
            <button class="launch-form-submit" onClick={$.submit}>Enqueue</button>
        </div>
    </div>
));
const LaunchFormPorts = launchFormSchema.ports;

type TCNSLaunchFormState = {
    options: TExoKeyedList<TCNSSelectOption>;
    fields: TExoKeyedList<TCNSPayloadField>;
    isOpen: boolean;
    selectedType: string;
    shownType: string;
    formFields: TCNSPayloadField[] | undefined;
    values: Record<string, string | boolean>;
};

const launchFormBase = createExoMachine(launchFormSchema, {
    createInitialState: (c: TCNSDevToolsNode): TCNSLaunchFormState => ({
        options: c.keyedList(LaunchFormPorts.options, (option: TCNSSelectOption) => option.value, option => c.build(selectOptionMachine, option), setOption),
        fields: c.keyedList(LaunchFormPorts.fields, (field: TCNSPayloadField) => field, field => c.build(payloadFieldMachine, field), setField),
        isOpen: false,
        selectedType: '',
        shownType: '',
        formFields: undefined,
        values: {},
    }),
});

function showLaunchForm(c: TExoMachineNodeOf<typeof launchFormBase>): void {
    const types = CNSExplorerReads.scheduledRowsOf(c, {}, 1).first?.types ?? [];
    const state = c.state;
    c.attr(LaunchFormPorts.hidden, types.length === 0 || !CNSExplorerReads.isStimulationActionAllowed(c, 'launch'));
    c.attr(LaunchFormPorts.openHidden, state.isOpen);
    c.attr(LaunchFormPorts.formHidden, !state.isOpen);
    state.options.reconcile(types.map(type => ({ value: type.collateralName, label: type.collateralName })));
    const type = types.find(candidate => candidate.collateralName === state.selectedType) ?? types[0];
    if (type === undefined || type.collateralName === state.shownType) return;
    state.shownType = type.collateralName;
    c.portNode(LaunchFormPorts.type).value = type.collateralName;
    c.attr(LaunchFormPorts.descriptionHidden, !type.description);
    c.text(LaunchFormPorts.description, type.description ?? '');
    state.formFields = CNSPayloadForm.fieldsOf(type.payloadSchema);
    state.values = {};
    c.attr(LaunchFormPorts.jsonHidden, state.formFields !== undefined);
    c.portNode(LaunchFormPorts.json).value = '{}';
    state.fields.reconcile(state.formFields ?? []);
}

export const launchFormMachine = composeExoMachine(
    launchFormBase,
    m => withExoTransitions(m, {
        open: c => {
            c.state.isOpen = true;
            showLaunchForm(c);
        },
        close: c => {
            c.state.isOpen = false;
            showLaunchForm(c);
        },
        selectType: (c, collateralName: string) => {
            c.state.selectedType = collateralName;
            showLaunchForm(c);
        },
        setValue: (c, name: string, value: string | boolean) => {
            c.state.values = { ...c.state.values, [name]: value };
        },
        submit: c => {
            const { formFields, values, shownType } = c.state;
            const result = formFields ? CNSPayloadForm.payloadOf(formFields, values) : CNSPayloadForm.jsonPayloadOf(c.portNode(LaunchFormPorts.json).value);
            const cns = injectCNS(c);
            if ('error' in result) cns.stimulate(explorerUiAxon.launchPayloadRejected.createSignal({ error: result.error }));
            else cns.stimulate(explorerUiAxon.stimulationLaunchRequested.createSignal({ collateralName: shownType, payload: result.payload }));
        },
    }),
    m => {
        const { open, close, selectType, setValue, submit } = m.transitions;
        return withExoHandlers(m, on => {
            on(LaunchFormPorts.open, c => open(c));
            on(LaunchFormPorts.close, c => close(c));
            on(LaunchFormPorts.typeChanged, c => selectType(c, c.portNode(LaunchFormPorts.type).value));
            on(LaunchFormPorts.fieldInput, (c, event) => {
                const control = event.target;
                if (control instanceof HTMLInputElement) setValue(c, control.name, control.type === 'checkbox' ? control.checked : control.value);
                else if (control instanceof HTMLSelectElement) setValue(c, control.name, control.value);
            });
            on(LaunchFormPorts.submit, c => submit(c));
        });
    },
    m => withOIMEffects(m, effect => {
        effect(c => showLaunchForm(c));
    })
);
