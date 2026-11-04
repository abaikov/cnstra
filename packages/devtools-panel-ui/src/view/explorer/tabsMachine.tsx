import { createExoMachine } from '@exodra/core';
import type { TExoChildrenPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSExplorerTab } from '../../types/TCNSExplorerTab';
import type { TCNSTabChoice } from '../../types/TCNSTabChoice';
import { tabButtonMachine } from './tabButtonMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const TAB_CHOICE_OF_TAB: { readonly [TTab in TCNSExplorerTab]: TCNSTabChoice & { tab: TTab } } = {
    stimulations: { tab: 'stimulations', label: 'Stimulations' },
    neurons: { tab: 'neurons', label: 'Neurons' },
    tasks: { tab: 'tasks', label: 'Activation tasks' },
    collaterals: { tab: 'collaterals', label: 'Collaterals' },
    scheduled: { tab: 'scheduled', label: 'Scheduled' },
};

const TABS: readonly TCNSTabChoice[] = Object.values(TAB_CHOICE_OF_TAB);

const tabsSchema = exoJsx<{ buttons: TExoChildrenPort }>($ => (
    <div class="exp-tabs"><$.buttons /></div>
));

export const tabsMachine = createExoMachine(tabsSchema, {
    createInitialState: (c: TCNSDevToolsNode) => {
        c.list(tabsSchema.ports.buttons, tabButtonMachine, TABS);
        return null;
    },
});
