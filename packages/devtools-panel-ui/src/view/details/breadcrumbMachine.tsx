import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoRefPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { CNSExplorerNavigation } from '../../model/CNSExplorerNavigation';
import type { TCNSCrumb } from '../../types/TCNSCrumb';
import { crumbMachine } from './crumbMachine';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const breadcrumbSchema = exoJsx<{ headingHidden: TExoAttrPort; trailHidden: TExoAttrPort; back: TExoEventPort; trail: TExoRefPort<HTMLElement>; crumbs: TExoChildrenPort }>($ => (
    <div>
        <div class="exp-heading eyebrow" data-tone="violet" hidden={$.headingHidden}>Details</div>
        <div class="exp-breadcrumb" hidden={$.trailHidden}>
            <button class="exp-crumb-back" title="Back to the previous entity" onClick={$.back}>← back</button>
            <div class="exp-breadcrumb-trail" ref={$.trail}><$.crumbs /></div>
        </div>
    </div>
));
const BreadcrumbPorts = breadcrumbSchema.ports;

const { setCrumb } = crumbMachine.transitions;

const breadcrumbBase = createExoMachine(breadcrumbSchema, {
    createInitialState: (c: TCNSDevToolsNode) => ({
        crumbs: c.keyedList(BreadcrumbPorts.crumbs, (crumb: TCNSCrumb) => `${crumb.index}:${crumb.entry.kind}:${crumb.entry.id}`, crumb => c.build(crumbMachine, crumb), setCrumb),
    }),
});

function showBreadcrumb(c: TExoMachineNodeOf<typeof breadcrumbBase>): void {
    const stack = CNSExplorerNavigation.stackOf(CNSExplorerReads.queryOf(c));
    c.attr(BreadcrumbPorts.headingHidden, stack.length > 0);
    c.attr(BreadcrumbPorts.trailHidden, stack.length === 0);
    c.state.crumbs.reconcile(stack.map((entry, index) => ({ entry, index, isLast: index === stack.length - 1 })));
    const trail = c.portNode(BreadcrumbPorts.trail);
    trail.scrollLeft = trail.scrollWidth;
}

export const breadcrumbMachine = composeExoMachine(
    breadcrumbBase,
    m => withCNSReceptors(m, receptor => {
        receptor(BreadcrumbPorts.back, explorerUiAxon.navigatedBack);
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showBreadcrumb(c));
    })
);
