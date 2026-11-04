import { createExoMachine } from '@exodra/core';
import type { TExoChildrenPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { actionFeedbackMachine } from '../scheduled/actionFeedbackMachine';
import { launchFormMachine } from '../launch/launchFormMachine';
import { scheduledListOptions } from './scheduledListOptions';
import { schedulesMachine } from '../scheduled/schedulesMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';
import { windowedListMachine } from './windowedListMachine';

const scheduledListSchema = exoJsx<{ feedback: TExoChildrenPort; launch: TExoChildrenPort; schedules: TExoChildrenPort; list: TExoChildrenPort }>($ => (
    <div class="list-pane">
        <$.feedback />
        <$.launch />
        <$.schedules />
        <$.list />
    </div>
));
const ScheduledListPorts = scheduledListSchema.ports;

export const scheduledListMachine = createExoMachine(scheduledListSchema, {
    createInitialState: (c: TCNSDevToolsNode) => {
        c.one(ScheduledListPorts.feedback, actionFeedbackMachine);
        c.one(ScheduledListPorts.launch, launchFormMachine);
        c.one(ScheduledListPorts.schedules, schedulesMachine, {});
        c.one(ScheduledListPorts.list, windowedListMachine, scheduledListOptions);
        return null;
    },
});
