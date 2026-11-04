import { createExoMachine } from '@exodra/core';
import type { TExoChildrenPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { ECNSStimulationStatus } from '@cnstra/persist-dto';
import { STIMULATION_STATUSES } from '../../constants/STIMULATION_STATUSES';
import type { TCNSStatusChoice } from '../../types/TCNSStatusChoice';
import { statusChoiceMachine } from './statusChoiceMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const STATUS_CHOICE_OF_STATUS: { readonly [TStatus in ECNSStimulationStatus]: TCNSStatusChoice & { status: TStatus } } = {
    completed: { status: 'completed', label: 'Completed', tone: 'green' },
    failed: { status: 'failed', label: 'Failed', tone: 'red' },
    running: { status: 'running', label: 'Running', tone: 'yellow' },
    aborted: { status: 'aborted', label: 'Aborted', tone: 'cyan' },
};

const STATUS_CHOICES: readonly TCNSStatusChoice[] = [
    { status: undefined, label: 'All', tone: 'pink' },
    ...STIMULATION_STATUSES.map(status => STATUS_CHOICE_OF_STATUS[status]),
];

const statusFilterSchema = exoJsx<{ choices: TExoChildrenPort }>($ => (
    <div class="exp-status-filter"><$.choices /></div>
));

export const statusFilterMachine = createExoMachine(statusFilterSchema, {
    createInitialState: (c: TCNSDevToolsNode) => {
        c.list(statusFilterSchema.ports.choices, statusChoiceMachine, STATUS_CHOICES);
        return null;
    },
});
