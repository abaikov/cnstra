import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSNavigationEntryKind } from '../../model/types/TCNSNavigationEntryKind';
import type { TCNSCrumb } from '../../types/TCNSCrumb';
import type { TCNSTone } from '../../types/TCNSTone';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const KIND_TONE: Record<TCNSNavigationEntryKind, TCNSTone> = { stimulation: 'yellow', neuron: 'violet', collateral: 'cyan', task: 'green' };
const KIND_GLYPH: Record<TCNSNavigationEntryKind, string> = { stimulation: '⚡', neuron: '▪', collateral: '◦', task: '⚙' };

const crumbSchema = exoJsx<{ separatorHidden: TExoAttrPort; className: TExoAttrPort; title: TExoAttrPort; tone: TExoAttrPort; go: TExoEventPort; glyph: TExoTextPort; label: TExoTextPort }>($ => (
    <span class="exp-crumb-slot">
        <span class="exp-crumb-separator" hidden={$.separatorHidden}>›</span>
        <button class={$.className} title={$.title} data-tone={$.tone} onClick={$.go}>
            <span class="exp-crumb-glyph">{$.glyph}</span>
            <span class="exp-crumb-label">{$.label}</span>
        </button>
    </span>
));
const CrumbPorts = crumbSchema.ports;

const crumbBase = createExoMachine(crumbSchema, { createInitialState: (_c: TCNSDevToolsNode, crumb: TCNSCrumb) => ({ crumb }) });

function showCrumb(c: TExoMachineNodeOf<typeof crumbBase>): void {
    const { entry, index, isLast } = c.state.crumb;
    c.attr(CrumbPorts.separatorHidden, index === 0);
    c.attr(CrumbPorts.className, isLast ? 'exp-crumb-current' : 'exp-crumb');
    c.attr(CrumbPorts.title, `${entry.kind}: ${entry.id}`);
    c.attr(CrumbPorts.tone, KIND_TONE[entry.kind]);
    c.text(CrumbPorts.glyph, KIND_GLYPH[entry.kind]);
    c.text(CrumbPorts.label, entry.id);
}

export const crumbMachine = composeExoMachine(
    crumbBase,
    m => withExoTransitions(m, {
        setCrumb: (c, crumb: TCNSCrumb) => {
            c.state.crumb = crumb;
            showCrumb(c);
        },
    }),
    m => withExoWire(m, c => showCrumb(c)),
    m => withCNSReceptors(m, receptor => {
        receptor(CrumbPorts.go, explorerUiAxon.crumbSelected, c => (c.state.crumb.isLast ? undefined : { index: c.state.crumb.index }));
    })
);
