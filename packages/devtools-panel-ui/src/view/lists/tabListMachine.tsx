import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoChildrenPort } from '@exodra/core';
import type { TExoChildList } from '@exodra/dom';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import type { TCNSExplorerTab } from '../../types/TCNSExplorerTab';
import type { TCNSWindowedListOptions } from '../../types/TCNSWindowedListOptions';
import { collateralListOptions } from './collateralListOptions';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { neuronListOptions } from './neuronListOptions';
import { scheduledListMachine } from './scheduledListMachine';
import { CNSChildSwitch } from '../../utils/CNSChildSwitch';
import type { TCNSShownChild } from '../../types/TCNSShownChild';
import { stimulationListOptions } from './stimulationListOptions';
import { taskListOptions } from './taskListOptions';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';
import { windowedListMachine } from './windowedListMachine';

const LIST_OPTIONS_OF_TAB: Record<Exclude<TCNSExplorerTab, 'scheduled'>, TCNSWindowedListOptions> = {
    stimulations: stimulationListOptions,
    neurons: neuronListOptions,
    collaterals: collateralListOptions,
    tasks: taskListOptions,
};

const tabListSchema = exoJsx<{ list: TExoChildrenPort }>($ => (
    <div class="list-pane"><$.list /></div>
));
const TabListPorts = tabListSchema.ports;

type TCNSTabListState = { list: TExoChildList; shown: { current: TCNSShownChild | undefined } };

export const tabListMachine = composeExoMachine(
    createExoMachine(tabListSchema, {
        createInitialState: (c: TCNSDevToolsNode): TCNSTabListState => ({ list: c.childList(TabListPorts.list), shown: { current: undefined } }),
    }),
    m => withOIMEffects(m, effect => {
        effect(c => {
            const { tab } = CNSExplorerReads.queryOf(c);
            if (tab === 'scheduled') CNSChildSwitch.show(c, c.state.list, c.state.shown, scheduledListMachine, null, tab);
            else CNSChildSwitch.show(c, c.state.list, c.state.shown, windowedListMachine, LIST_OPTIONS_OF_TAB[tab], tab);
        });
    })
);
