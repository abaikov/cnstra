import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSStimulationAttempt } from '@cnstra/persist-dto';
import { CNSStatusPill } from '../../utils/CNSStatusPill';
import type { TCNSStatusPillPorts } from '../../types/TCNSStatusPillPorts';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const attemptLineSchema = exoJsx<TCNSStatusPillPorts & { tone: TExoAttrPort; number: TExoTextPort; hops: TExoTextPort }>($ => (
    <div class="exp-attempt-line" data-tone={$.tone}>
        <span class="exp-attempt-number">{$.number}</span>
        <span class="status-pill" data-status={$.pillStatus}>
            <span class="exp-status-dot" />
            <span>{$.pillText}</span>
        </span>
        <span class="exp-detail-caption">{$.hops}</span>
    </div>
));
const AttemptLinePorts = attemptLineSchema.ports;

const attemptLineBase = createExoMachine(attemptLineSchema, { createInitialState: (_c: TCNSDevToolsNode, attempt: TCNSStimulationAttempt) => ({ attempt }) });

function showAttemptLine(c: TExoMachineNodeOf<typeof attemptLineBase>): void {
    const { attempt } = c.state;
    const status = attempt.hasError ? 'failed' : attempt.status;
    c.attr(AttemptLinePorts.tone, attempt.hasError ? 'red' : 'green');
    c.text(AttemptLinePorts.number, `#${attempt.attemptNumber}`);
    CNSStatusPill.show(c, AttemptLinePorts, status);
    c.text(AttemptLinePorts.hops, `${attempt.hopCount} hops`);
}

export const attemptLineMachine = composeExoMachine(
    attemptLineBase,
    m => withExoTransitions(m, {
        setAttempt: (c, attempt: TCNSStimulationAttempt) => {
            c.state.attempt = attempt;
            showAttemptLine(c);
        },
    }),
    m => withExoWire(m, c => showAttemptLine(c))
);
