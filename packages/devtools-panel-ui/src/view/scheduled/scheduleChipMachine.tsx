import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSStimulationScheduleState } from '@cnstra/persist-dto';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const intervalTextOf = (intervalMs: number): string =>
    intervalMs % 3_600_000 === 0
        ? `${intervalMs / 3_600_000}h`
        : intervalMs % 60_000 === 0
          ? `${intervalMs / 60_000}m`
          : intervalMs % 1000 === 0
            ? `${intervalMs / 1000}s`
            : `${intervalMs}ms`;

const scheduleChipSchema = exoJsx<{ title: TExoAttrPort; label: TExoTextPort }>($ => (
    <span class="schedule-chip" title={$.title}>{$.label}</span>
));
const ScheduleChipPorts = scheduleChipSchema.ports;

const scheduleChipBase = createExoMachine(scheduleChipSchema, {
    createInitialState: (_c: TCNSDevToolsNode, schedule: TCNSStimulationScheduleState) => ({ schedule }),
});

function showScheduleChip(c: TExoMachineNodeOf<typeof scheduleChipBase>): void {
    const { schedule } = c.state;
    const every = schedule.cron ?? (schedule.everyMs !== undefined ? `every ${intervalTextOf(schedule.everyMs)}` : schedule.scheduleId);
    c.attr(ScheduleChipPorts.title, schedule.scheduleId);
    c.text(ScheduleChipPorts.label, `⏱ ${schedule.collateralName} · ${every}${schedule.tz ? ` ${schedule.tz}` : ''}`);
}

export const scheduleChipMachine = composeExoMachine(
    scheduleChipBase,
    m => withExoTransitions(m, {
        setSchedule: (c, schedule: TCNSStimulationScheduleState) => {
            c.state.schedule = schedule;
            showScheduleChip(c);
        },
    }),
    m => withExoWire(m, c => showScheduleChip(c))
);
