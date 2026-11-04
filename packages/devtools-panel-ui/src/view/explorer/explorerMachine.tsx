import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { breadcrumbMachine } from '../details/breadcrumbMachine';
import { collateralTypeaheadOptions } from '../filters/collateralTypeaheadOptions';
import { connectionBadgeMachine } from './connectionBadgeMachine';
import { detailsMachine } from '../details/detailsMachine';
import { entryToggleMachine } from '../filters/entryToggleMachine';
import { filterChipsMachine } from '../filters/filterChipsMachine';
import { graphsMachine } from '../graphs/graphsMachine';
import { neuronTypeaheadOptions } from '../filters/neuronTypeaheadOptions';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { searchMachine } from '../filters/searchMachine';
import { statusFilterMachine } from '../filters/statusFilterMachine';
import { tabListMachine } from '../lists/tabListMachine';
import { tabsMachine } from './tabsMachine';
import { timeRangeMachine } from '../filters/timeRangeMachine';
import { typeaheadMachine } from '../filters/typeaheadMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const explorerSchema = exoJsx<{
    tab: TExoAttrPort; connection: TExoChildrenPort; tabs: TExoChildrenPort; statusFilter: TExoChildrenPort; entryToggle: TExoChildrenPort; search: TExoChildrenPort;
    neuronTypeahead: TExoChildrenPort; collateralTypeahead: TExoChildrenPort; timeRange: TExoChildrenPort; chips: TExoChildrenPort;
    list: TExoChildrenPort; graphs: TExoChildrenPort; breadcrumb: TExoChildrenPort; details: TExoChildrenPort;
}>($ => (
    <div class="exp-root">
        <div class="exp-column exp-column-list">
            <div class="zone exp-controls" data-tab={$.tab}>
                <div class="exp-controls-top">
                    <div class="exp-controls-connection"><$.connection /></div>
                    <div class="exp-controls-tabs"><$.tabs /></div>
                </div>
                <div class="exp-filters">
                    <div class="fg-toggles">
                        <div class="fg-status"><$.statusFilter /></div>
                    </div>
                    <div class="fg-inputs">
                        <div class="fg-entry"><$.entryToggle /></div>
                        <div class="fg-search"><$.search /></div>
                        <div class="fg-neuron"><$.neuronTypeahead /></div>
                        <div class="fg-collateral"><$.collateralTypeahead /></div>
                    </div>
                </div>
                <div class="exp-time"><$.timeRange /></div>
                <div class="exp-chips"><$.chips /></div>
            </div>
            <div class="zone exp-zone-fill">
                <div class="exp-zone-body"><$.list /></div>
            </div>
        </div>
        <div class="exp-column exp-column-detail">
            <$.graphs />
            <div class="zone exp-zone-fill">
                <div class="exp-zone-header"><$.breadcrumb /></div>
                <div class="exp-zone-body exp-zone-scroll"><$.details /></div>
            </div>
        </div>
    </div>
));
const ExplorerPorts = explorerSchema.ports;

export const explorerMachine = composeExoMachine(
    createExoMachine(explorerSchema, {
        createInitialState: (c: TCNSDevToolsNode) => {
            c.one(ExplorerPorts.connection, connectionBadgeMachine);
            c.one(ExplorerPorts.tabs, tabsMachine);
            c.one(ExplorerPorts.statusFilter, statusFilterMachine);
            c.one(ExplorerPorts.entryToggle, entryToggleMachine);
            c.one(ExplorerPorts.search, searchMachine);
            c.one(ExplorerPorts.neuronTypeahead, typeaheadMachine, neuronTypeaheadOptions);
            c.one(ExplorerPorts.collateralTypeahead, typeaheadMachine, collateralTypeaheadOptions);
            c.one(ExplorerPorts.timeRange, timeRangeMachine);
            c.one(ExplorerPorts.chips, filterChipsMachine);
            c.one(ExplorerPorts.list, tabListMachine);
            c.one(ExplorerPorts.graphs, graphsMachine);
            c.one(ExplorerPorts.breadcrumb, breadcrumbMachine);
            c.one(ExplorerPorts.details, detailsMachine);
            return null;
        },
    }),
    m => withOIMEffects(m, effect => {
        effect(c => c.attr(ExplorerPorts.tab, CNSExplorerReads.queryOf(c).tab));
    })
);
