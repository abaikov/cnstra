import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import type { TCNSStimulationScheduleState } from '@cnstra/persist-dto';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSScheduledFilter } from '../../types/TCNSScheduledFilter';
import { scheduleChipMachine } from './scheduleChipMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const { setSchedule } = scheduleChipMachine.transitions;

const schedulesSchema = exoJsx<{ hidden: TExoAttrPort; chips: TExoChildrenPort }>($ => (
    <div class="schedules" hidden={$.hidden}><$.chips /></div>
));
const SchedulesPorts = schedulesSchema.ports;

export const schedulesMachine = composeExoMachine(
    createExoMachine(schedulesSchema, {
        createInitialState: (c: TCNSDevToolsNode, filter: TCNSScheduledFilter) => ({
            filter,
            chips: c.keyedList(SchedulesPorts.chips, (schedule: TCNSStimulationScheduleState) => schedule.scheduleId, schedule => c.build(scheduleChipMachine, schedule), setSchedule),
        }),
    }),
    m => withOIMEffects(m, effect => {
        effect(c => {
            const schedules = CNSExplorerReads.scheduledRowsOf(c, c.state.filter, 1).first?.schedules ?? [];
            c.attr(SchedulesPorts.hidden, schedules.length === 0);
            c.state.chips.reconcile(schedules);
        });
    })
);
