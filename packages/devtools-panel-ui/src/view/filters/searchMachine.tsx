import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions } from '@exodra/core';
import type { TExoEventPort, TExoRefPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { injectCNS } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const SEARCH_DEBOUNCE_MS = 300;

const searchSchema = exoJsx<{ field: TExoRefPort<HTMLInputElement>; type: TExoEventPort }>($ => (
    <input class="text-input exp-search" placeholder="search stimulationId…" ref={$.field} onInput={$.type} />
));
const SearchPorts = searchSchema.ports;

type TCNSSearchState = { debounce: ReturnType<typeof setTimeout> | undefined };

const searchBase = createExoMachine(searchSchema, {
    createInitialState: (c: TCNSDevToolsNode): TCNSSearchState => {
        const state: TCNSSearchState = { debounce: undefined };
        c.onTeardown(() => clearTimeout(state.debounce));
        return state;
    },
});

export const searchMachine = composeExoMachine(
    searchBase,
    m => withExoTransitions(m, {
        type: (c, text: string) => {
            clearTimeout(c.state.debounce);
            c.state.debounce = setTimeout(() => {
                c.state.debounce = undefined;
                injectCNS(c).stimulate(explorerUiAxon.queryPatched.createSignal({ patch: { text: text || undefined } }));
            }, SEARCH_DEBOUNCE_MS);
        },
    }),
    m => {
        const { type } = m.transitions;
        return withExoHandlers(m, on => {
            on(SearchPorts.type, c => type(c, c.portNode(SearchPorts.field).value));
        });
    }
);
