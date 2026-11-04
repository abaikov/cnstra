import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { injectCNS, withCNSReceptors } from '@cnstra/exodra';
import type { TCNSScheduledStimulationState, TCNSStimulationCommand } from '@cnstra/persist-dto';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSScheduledRowParams } from '../../types/TCNSScheduledRowParams';
import type { TCNSStatusPillPorts } from '../../types/TCNSStatusPillPorts';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { CNSStatusPill } from '../../utils/CNSStatusPill';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const CANCEL_ARMED_MS = 5_000;

const dueTextOf = (runAfter: number, nowMs: number): string => {
    const remainingMs = runAfter - nowMs;
    if (remainingMs <= 0) return 'due';
    const seconds = Math.round(remainingMs / 1000);
    if (seconds < 60) return `in ${seconds}s`;
    const minutes = Math.round(remainingMs / 60_000);
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.round(remainingMs / 3_600_000);
    if (hours < 24) return `in ${hours}h`;
    return `in ${Math.round(remainingMs / 86_400_000)}d`;
};

const scheduledRowSchema = exoJsx<TCNSStatusPillPorts & {
    className: TExoAttrPort; active: TExoAttrPort; status: TExoAttrPort; rowIndex: TExoAttrPort; open: TExoEventPort; title: TExoTextPort; keyHidden: TExoAttrPort; key: TExoTextPort; groupHidden: TExoAttrPort; group: TExoTextPort;
    subtitle: TExoTextPort; tasksLead: TExoTextPort; tasks: TExoTextPort; due: TExoTextPort; triesHidden: TExoAttrPort; tries: TExoTextPort; triesLabel: TExoTextPort; priorityHidden: TExoAttrPort; priority: TExoTextPort;
    commandsHidden: TExoAttrPort; commandClick: TExoEventPort<MouseEvent>; runNowHidden: TExoAttrPort; runNow: TExoEventPort; raise: TExoEventPort; raiseTitle: TExoAttrPort; lower: TExoEventPort; lowerTitle: TExoAttrPort; cancel: TExoEventPort;
}>($ => (
    <div class={$.className} data-active={$.active} data-status={$.status} style={$.rowIndex} onClick={$.open}>
        <div class="row-left">
            <div class="row-heading row-heading-tagged">
                <span class="row-title">{$.title}</span>
                <span class="tag tag-violet" hidden={$.keyHidden}>{$.key}</span>
                <span class="tag tag-cyan" hidden={$.groupHidden}>{$.group}</span>
                <span class="row-sub">{$.subtitle}</span>
            </div>
            <div class="scheduled-tasks">
                <span class="scheduled-tasks-lead">{$.tasksLead}</span>
                <span class="scheduled-tasks-names">{$.tasks}</span>
            </div>
        </div>
        <div class="row-right">
            <span class="row-note">{$.due}</span>
            <div class="metric" hidden={$.triesHidden}>
                <span class="metric-value scheduled-tries">{$.tries}</span>
                <span class="metric-label">{$.triesLabel}</span>
            </div>
            <div class="metric" hidden={$.priorityHidden}>
                <span class="metric-value scheduled-priority">{$.priority}</span>
                <span class="metric-label">prio</span>
            </div>
            <span class="status-pill" data-status={$.pillStatus}>
                <span class="exp-status-dot" />
                <span>{$.pillText}</span>
            </span>
            <div class="exp-commands" hidden={$.commandsHidden} onClick={$.commandClick}>
                <button class="exp-command command command-green" title="Run now" hidden={$.runNowHidden} onClick={$.runNow}>▶</button>
                <button class="exp-command command command-violet" title={$.raiseTitle} onClick={$.raise}>▲</button>
                <button class="exp-command command command-violet" title={$.lowerTitle} onClick={$.lower}>▼</button>
                <button class="exp-command command command-red" title="Cancel (press twice)" onClick={$.cancel}>✕</button>
            </div>
        </div>
    </div>
));
const ScheduledRowPorts = scheduledRowSchema.ports;

const scheduledRowBase = createExoMachine(scheduledRowSchema, {
    createInitialState: (_c: TCNSDevToolsNode, row: TCNSScheduledRowParams) => ({ row, cancelArmedAtMs: 0 }),
});

function showScheduledStimulation(c: TExoMachineNodeOf<typeof scheduledRowBase>, scheduled: TCNSScheduledStimulationState): void {
    c.attr(ScheduledRowPorts.status, scheduled.status);
    c.text(ScheduledRowPorts.title, scheduled.entry.collateralName);
    c.attr(ScheduledRowPorts.keyHidden, scheduled.jobKey === undefined);
    c.text(ScheduledRowPorts.key, `key ${scheduled.jobKey ?? ''}`);
    c.attr(ScheduledRowPorts.groupHidden, scheduled.jobGroup === undefined);
    c.text(ScheduledRowPorts.group, `group ${scheduled.jobGroup ?? ''}`);
    c.text(ScheduledRowPorts.subtitle, scheduled.stimulationId);
    c.text(ScheduledRowPorts.tasksLead, scheduled.resumes ? '▸ resumes at ' : '▸ into ');
    c.text(ScheduledRowPorts.tasks, scheduled.tasks.length ? scheduled.tasks.map(task => `${task.neuronName} ◂ ${task.dendriteCollateralName}`).join(' · ') : 'no subscribers');
    c.text(ScheduledRowPorts.due, scheduled.status === 'ready' ? 'due' : dueTextOf(scheduled.runAfter, Date.now()));
    c.attr(ScheduledRowPorts.triesHidden, scheduled.attemptCount === 0);
    c.text(ScheduledRowPorts.tries, scheduled.attemptCount);
    c.text(ScheduledRowPorts.triesLabel, scheduled.attemptCount === 1 ? 'try' : 'tries');
    c.attr(ScheduledRowPorts.priorityHidden, scheduled.priority === 0);
    c.text(ScheduledRowPorts.priority, scheduled.priority);
    c.attr(ScheduledRowPorts.runNowHidden, scheduled.status !== 'scheduled');
    c.attr(ScheduledRowPorts.raiseTitle, `Raise priority (now ${scheduled.priority})`);
    c.attr(ScheduledRowPorts.lowerTitle, `Lower priority (now ${scheduled.priority})`);
    CNSStatusPill.show(c, ScheduledRowPorts, scheduled.status);
}

const scheduledStimulationOf = (c: TExoMachineNodeOf<typeof scheduledRowBase>) => CNSExplorerReads.scheduledStimulationOf(c, c.state.row.item);

const commandPayloadOf = (c: TExoMachineNodeOf<typeof scheduledRowBase>, command: TCNSStimulationCommand) => ({ stimulationId: c.state.row.item, command });

const priorityCommandPayloadOf = (c: TExoMachineNodeOf<typeof scheduledRowBase>, priorityStep: number) => {
    const scheduled = scheduledStimulationOf(c);
    return scheduled === undefined ? undefined : commandPayloadOf(c, { name: 'prioritize', priority: scheduled.priority + priorityStep });
};

export const scheduledRowMachine = composeExoMachine(
    scheduledRowBase,
    m => withExoTransitions(m, {
        setRow: (c, row: TCNSScheduledRowParams) => {
            c.state.row = row;
            c.attr(ScheduledRowPorts.rowIndex, `--row-index:${row.index}`);
        },
        pressCancel: c => {
            const stimulationId = c.state.row.item;
            const nowMs = Date.now();
            const cns = injectCNS(c);
            if (nowMs - c.state.cancelArmedAtMs < CANCEL_ARMED_MS) {
                c.state.cancelArmedAtMs = 0;
                cns.stimulate(explorerUiAxon.stimulationCommandRequested.createSignal({ stimulationId, command: { name: 'cancel' } }));
                return;
            }
            c.state.cancelArmedAtMs = nowMs;
            cns.stimulate(explorerUiAxon.cancelConfirmationRequested.createSignal({ stimulationId }));
        },
    }),
    m => withExoWire(m, c => {
        const { index, isInline } = c.state.row;
        c.attr(ScheduledRowPorts.className, isInline ? 'exp-act-row scheduled-row-inline' : 'exp-row list-row scheduled-row');
        c.attr(ScheduledRowPorts.rowIndex, `--row-index:${index}`);
    }),
    m => {
        const { pressCancel } = m.transitions;
        return withExoHandlers(m, on => {
            on(ScheduledRowPorts.commandClick, (_c, event) => event.stopPropagation());
            on(ScheduledRowPorts.cancel, c => pressCancel(c));
        });
    },
    m => withCNSReceptors(m, receptor => {
        receptor(ScheduledRowPorts.open, explorerUiAxon.entityOpened, c => {
            const scheduled = scheduledStimulationOf(c);
            if (scheduled === undefined) return undefined;
            const isFresh = c.state.row.isInline !== true;
            return scheduled.resumes || scheduled.attemptCount > 0
                ? CNSEntityOpening.of('stimulation', scheduled.stimulationId, isFresh)
                : CNSEntityOpening.of('collateral', scheduled.entry.collateralName, isFresh);
        });
        receptor(ScheduledRowPorts.runNow, explorerUiAxon.stimulationCommandRequested, c => commandPayloadOf(c, { name: 'runNow' }));
        receptor(ScheduledRowPorts.raise, explorerUiAxon.stimulationCommandRequested, c => priorityCommandPayloadOf(c, 1));
        receptor(ScheduledRowPorts.lower, explorerUiAxon.stimulationCommandRequested, c => priorityCommandPayloadOf(c, -1));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => c.attr(ScheduledRowPorts.commandsHidden, !CNSExplorerReads.isStimulationActionAllowed(c, 'command')));
        effect(c => c.attr(ScheduledRowPorts.active, c.state.row.isInline !== true && CNSExplorerReads.queryOf(c).selected === c.state.row.item));
        effect(c => {
            const scheduled = scheduledStimulationOf(c);
            if (scheduled !== undefined) showScheduledStimulation(c, scheduled);
        });
    })
);
