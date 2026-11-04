import { composeExoMachine, createExoMachine, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSFact } from '../../types/TCNSFact';
import type { TCNSScopeCard } from '../../types/TCNSScopeCard';
import { factMachine } from './factMachine';
import { nodeLinkDiagramMachine } from '../diagram/nodeLinkDiagramMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const scopeCardSchema = exoJsx<{
    tone: TExoAttrPort; eyebrow: TExoTextPort; title: TExoTextPort; description: TExoTextPort; stat: TExoTextPort; statLabel: TExoTextPort;
    entryPillHidden: TExoAttrPort; facts: TExoChildrenPort; ratioHidden: TExoAttrPort; ratioTone: TExoAttrPort; ratio: TExoAttrPort; ratioCaption: TExoTextPort; diagram: TExoChildrenPort;
}>($ => (
    <div class="exp-scope-card" data-tone={$.tone}>
        <div class="exp-scope-card-head">
            <div class="exp-scope-card-summary">
                <div class="exp-heading eyebrow exp-tone-text">{$.eyebrow}</div>
                <div class="exp-scope-card-title">{$.title}</div>
                <div class="exp-scope-card-description">{$.description}</div>
                <div class="exp-scope-card-stats">
                    <div class="exp-scope-card-stat">
                        <div class="exp-scope-card-stat-value">{$.stat}</div>
                        <div class="exp-scope-card-stat-label">{$.statLabel}</div>
                    </div>
                    <span class="exp-entry-pill" hidden={$.entryPillHidden}>entry</span>
                </div>
            </div>
            <div class="exp-scope-card-facts">
                <$.facts />
                <div class="exp-scope-card-ratio" hidden={$.ratioHidden} data-tone={$.ratioTone}>
                    <meter class="exp-ratio" min="0" max="1" value={$.ratio} />
                    <div class="exp-scope-card-ratio-caption">{$.ratioCaption}</div>
                </div>
            </div>
        </div>
        <div class="exp-scope-card-diagram"><$.diagram /></div>
    </div>
));
const ScopeCardPorts = scopeCardSchema.ports;

const { setFact } = factMachine.transitions;
const { setDiagram } = nodeLinkDiagramMachine.transitions;

const scopeCardBase = createExoMachine(scopeCardSchema, {
    createInitialState: (c: TCNSDevToolsNode) => ({
        facts: c.keyedList(ScopeCardPorts.facts, (fact: TCNSFact) => fact.label, fact => c.build(factMachine, fact), setFact),
        diagram: c.one(ScopeCardPorts.diagram, nodeLinkDiagramMachine),
    }),
});

function showScopeCard(c: TExoMachineNodeOf<typeof scopeCardBase>, scope: TCNSScopeCard): void {
    c.attr(ScopeCardPorts.tone, scope.tone);
    c.text(ScopeCardPorts.eyebrow, scope.eyebrow);
    c.text(ScopeCardPorts.title, scope.title);
    c.text(ScopeCardPorts.description, scope.description);
    c.text(ScopeCardPorts.stat, scope.stat);
    c.text(ScopeCardPorts.statLabel, scope.statLabel);
    c.attr(ScopeCardPorts.entryPillHidden, !scope.isEntry);
    c.state.facts.reconcile(scope.facts);
    c.attr(ScopeCardPorts.ratioHidden, scope.ratio === undefined);
    if (scope.ratio !== undefined) {
        c.attr(ScopeCardPorts.ratioTone, scope.ratio.tone);
        c.attr(ScopeCardPorts.ratio, Math.max(0, Math.min(1, scope.ratio.value)));
        c.text(ScopeCardPorts.ratioCaption, scope.ratio.caption);
    }
    setDiagram(c.state.diagram, scope.diagram);
}

export const scopeCardMachine = composeExoMachine(
    scopeCardBase,
    m => withExoTransitions(m, {
        setScope: (c, scope: TCNSScopeCard) => showScopeCard(c, scope),
    })
);
