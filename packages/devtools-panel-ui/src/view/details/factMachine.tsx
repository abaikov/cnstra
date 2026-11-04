import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSFact } from '../../types/TCNSFact';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const factSchema = exoJsx<{ label: TExoTextPort; tone: TExoAttrPort; opens: TExoAttrPort; value: TExoTextPort; open: TExoEventPort }>($ => (
    <div class="exp-fact">
        <span class="exp-fact-label">{$.label}</span>
        <span class="exp-fact-value" data-tone={$.tone} data-opens={$.opens} onClick={$.open}>{$.value}</span>
    </div>
));
const FactPorts = factSchema.ports;

const factBase = createExoMachine(factSchema, { createInitialState: (_c: TCNSDevToolsNode, fact: TCNSFact) => ({ fact }) });

function showFact(c: TExoMachineNodeOf<typeof factBase>): void {
    const { fact } = c.state;
    c.text(FactPorts.label, fact.label);
    c.text(FactPorts.value, fact.value);
    c.attr(FactPorts.tone, fact.tone);
    c.attr(FactPorts.opens, fact.opens !== undefined);
}

export const factMachine = composeExoMachine(
    factBase,
    m => withExoTransitions(m, {
        setFact: (c, fact: TCNSFact) => {
            c.state.fact = fact;
            showFact(c);
        },
    }),
    m => withExoWire(m, c => showFact(c)),
    m => withCNSReceptors(m, receptor => {
        receptor(FactPorts.open, explorerUiAxon.entityOpened, c => (c.state.fact.opens === undefined ? undefined : { entry: c.state.fact.opens, fresh: false }));
    })
);
