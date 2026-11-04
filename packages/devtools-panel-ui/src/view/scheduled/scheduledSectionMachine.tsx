import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSScheduledFilter } from '../../types/TCNSScheduledFilter';
import type { TCNSScheduledRowParams } from '../../types/TCNSScheduledRowParams';
import { actionFeedbackMachine } from './actionFeedbackMachine';
import { scheduledRowMachine } from './scheduledRowMachine';
import { schedulesMachine } from './schedulesMachine';
import { UNAVAILABLE_SCHEDULED_HINT } from '../../constants/UNAVAILABLE_SCHEDULED_HINT';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const scheduledSectionSchema = exoJsx<{ feedback: TExoChildrenPort; count: TExoTextPort; schedules: TExoChildrenPort; messageHidden: TExoAttrPort; message: TExoTextPort; rows: TExoChildrenPort; moreHidden: TExoAttrPort; more: TExoEventPort; moreLabel: TExoTextPort }>($ => (
    <div class="exp-detail-section">
        <div class="exp-detail-section-head">
            <div class="exp-heading eyebrow" data-tone="violet">Scheduled</div>
            <$.feedback />
            <span class="exp-detail-caption">{$.count}</span>
        </div>
        <$.schedules />
        <div class="exp-detail-empty" hidden={$.messageHidden}>{$.message}</div>
        <div class="exp-detail-rows"><$.rows /></div>
        <button class="exp-more" hidden={$.moreHidden} onClick={$.more}>{$.moreLabel}</button>
    </div>
));
const ScheduledSectionPorts = scheduledSectionSchema.ports;

const { setRow } = scheduledRowMachine.transitions;

type TCNSScheduledSectionParams = { filter: TCNSScheduledFilter; where: string };

const scheduledSectionBase = createExoMachine(scheduledSectionSchema, {
    createInitialState: (c: TCNSDevToolsNode, params: TCNSScheduledSectionParams) => {
        c.one(ScheduledSectionPorts.feedback, actionFeedbackMachine);
        c.one(ScheduledSectionPorts.schedules, schedulesMachine, params.filter);
        return {
            ...params,
            rows: c.keyedList(ScheduledSectionPorts.rows, (row: TCNSScheduledRowParams) => row.item, row => c.build(scheduledRowMachine, row), setRow),
            pageCount: 1,
        };
    },
});

function showScheduledSection(c: TExoMachineNodeOf<typeof scheduledSectionBase>): void {
    const { rows, hasMore, isLoading, first } = CNSExplorerReads.scheduledStimulationIdsOf(c, c.state.filter, c.state.pageCount);
    const { where } = c.state;
    c.text(ScheduledSectionPorts.count, rows.length ? `${rows.length}${hasMore ? '+' : ''} waiting ${where}` : '');
    const message = isLoading && first === undefined
        ? 'Loading…'
        : first?.available === false
          ? UNAVAILABLE_SCHEDULED_HINT
          : rows.length === 0
            ? hasMore ? `None ${where} among the jobs scanned so far.` : `Nothing is scheduled ${where}.`
            : '';
    c.attr(ScheduledSectionPorts.messageHidden, message === '');
    c.text(ScheduledSectionPorts.message, message);
    c.attr(ScheduledSectionPorts.moreHidden, !hasMore);
    c.text(ScheduledSectionPorts.moreLabel, rows.length ? 'Show more' : 'Scan further');
    c.state.rows.reconcile(rows.map((item, index) => ({ item, index, isInline: true })));
}

export const scheduledSectionMachine = composeExoMachine(
    scheduledSectionBase,
    m => withOIMEffects(m, effect => {
        effect(c => showScheduledSection(c));
    }),
    m => {
        const showSectionEffect = m.effects[m.effects.length - 1];
        return withExoTransitions(m, {
            showNextPage: c => {
                c.state.pageCount++;
                c.restartEffect(showSectionEffect);
            },
        });
    },
    m => {
        const { showNextPage } = m.transitions;
        return withExoHandlers(m, on => {
            on(ScheduledSectionPorts.more, c => showNextPage(c));
        });
    }
);
