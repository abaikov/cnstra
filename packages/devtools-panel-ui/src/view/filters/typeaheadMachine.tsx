import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoRefPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TExoKeyedList } from '@exodra/list-reconcile';
import { withOIMEffects } from '@oimdb/exodra';
import { injectCNS } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSTypeaheadOptions } from '../../types/TCNSTypeaheadOptions';
import { typeaheadItemMachine } from './typeaheadItemMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const TYPEAHEAD_CLOSE_DELAY_MS = 150;
const TYPEAHEAD_MAX_ITEMS = 12;

const typeaheadSchema = exoJsx<{
    placeholder: TExoAttrPort; field: TExoRefPort<HTMLInputElement>; type: TExoEventPort; focus: TExoEventPort; blur: TExoEventPort;
    dropdownHidden: TExoAttrPort; matchCount: TExoTextPort; pick: TExoEventPort<MouseEvent>; items: TExoChildrenPort;
}>($ => (
    <div class="exp-typeahead">
        <input class="text-input exp-typeahead-field" placeholder={$.placeholder} ref={$.field} onInput={$.type} on:focusin={$.focus} on:focusout={$.blur} />
        <div class="exp-typeahead-dropdown" hidden={$.dropdownHidden}>
            <div class="exp-typeahead-count">{$.matchCount}</div>
            <div on:mousedown={$.pick}><$.items /></div>
        </div>
    </div>
));
const TypeaheadPorts = typeaheadSchema.ports;

const { setName } = typeaheadItemMachine.transitions;

type TCNSTypeaheadState = TCNSTypeaheadOptions & {
    items: TExoKeyedList<string>;
    isOpen: boolean;
    text: string;
    closing: ReturnType<typeof setTimeout> | undefined;
};

const typeaheadBase = createExoMachine(typeaheadSchema, {
    createInitialState: (c: TCNSDevToolsNode, options: TCNSTypeaheadOptions): TCNSTypeaheadState => {
        const state: TCNSTypeaheadState = {
            ...options,
            items: c.keyedList(TypeaheadPorts.items, (name: string) => name, name => c.build(typeaheadItemMachine, name), setName),
            isOpen: false,
            text: '',
            closing: undefined,
        };
        c.onTeardown(() => clearTimeout(state.closing));
        return state;
    },
});

function showTypeahead(c: TExoMachineNodeOf<typeof typeaheadBase>): void {
    const { isOpen, text, items } = c.state;
    c.attr(TypeaheadPorts.dropdownHidden, !isOpen);
    if (!isOpen) return;
    const needle = text.trim().toLowerCase();
    const matches = c.state.namesOf(c).filter(name => name.toLowerCase().includes(needle));
    c.text(TypeaheadPorts.matchCount, matches.length === 0 ? 'no matches' : `${matches.length} match${matches.length === 1 ? '' : 'es'}`);
    items.reconcile(matches.slice(0, TYPEAHEAD_MAX_ITEMS));
}

const pickedNameOf = (event: MouseEvent): string | null =>
    event.target instanceof Element ? event.target.closest('[data-name]')?.getAttribute('data-name') ?? null : null;

export const typeaheadMachine = composeExoMachine(
    typeaheadBase,
    m => withExoTransitions(m, {
        type: (c, text: string) => {
            c.state.text = text;
            c.state.isOpen = true;
            showTypeahead(c);
        },
        open: c => {
            clearTimeout(c.state.closing);
            c.state.isOpen = true;
            showTypeahead(c);
        },
        close: c => {
            clearTimeout(c.state.closing);
            c.state.closing = setTimeout(() => {
                c.state.closing = undefined;
                c.state.isOpen = false;
                showTypeahead(c);
            }, TYPEAHEAD_CLOSE_DELAY_MS);
        },
        pick: (c, name: string) => {
            injectCNS(c).stimulate(explorerUiAxon.queryPatched.createSignal({ patch: c.state.patchOf(name) }));
            c.state.isOpen = false;
            c.state.text = '';
            c.portNode(TypeaheadPorts.field).value = '';
            showTypeahead(c);
        },
    }),
    m => withExoWire(m, (c, options) => c.attr(TypeaheadPorts.placeholder, options.placeholder)),
    m => {
        const { type, open, close, pick } = m.transitions;
        return withExoHandlers(m, on => {
            on(TypeaheadPorts.type, c => type(c, c.portNode(TypeaheadPorts.field).value));
            on(TypeaheadPorts.focus, c => open(c));
            on(TypeaheadPorts.blur, c => close(c));
            on(TypeaheadPorts.pick, (c, event) => {
                const name = pickedNameOf(event);
                if (name !== null) pick(c, name);
            });
        });
    },
    m => withOIMEffects(m, effect => {
        effect(c => showTypeahead(c));
    })
);
