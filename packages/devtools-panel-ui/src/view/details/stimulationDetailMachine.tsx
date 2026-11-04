import { composeExoMachine, createExoMachine, wireExoNode } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import { ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import type { ECNSStimulationStatus, TCNSStimulationAttempt } from '@cnstra/persist-dto';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSStage } from '../../types/TCNSStage';
import { attemptLineMachine } from './attemptLineMachine';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { latestAttemptOf } from '../../model/latestAttemptOf';
import { pipeConnectorMachine } from './pipeConnectorMachine';
import { stageMachine } from './stageMachine';
import { CNSErrorMessage } from '../../utils/CNSErrorMessage';
import { CNSStatusPill } from '../../utils/CNSStatusPill';
import { CNSTaskKey } from '../../utils/CNSTaskKey';
import type { TCNSStatusPillPorts } from '../../types/TCNSStatusPillPorts';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const stimulationDetailSchema = exoJsx<TCNSStatusPillPorts & {
    loadingHidden: TExoAttrPort; loadingTone: TExoAttrPort; loading: TExoTextPort; bodyHidden: TExoAttrPort;
    retryHidden: TExoAttrPort; retryDisabled: TExoAttrPort; retryLabel: TExoTextPort; retry: TExoEventPort;
    cloneHidden: TExoAttrPort; cloneDisabled: TExoAttrPort; cloneLabel: TExoTextPort; clone: TExoEventPort;
    stimulationId: TExoTextPort; toastHidden: TExoAttrPort; toastTone: TExoAttrPort; toast: TExoTextPort;
    entryName: TExoTextPort; attemptCount: TExoTextPort; entryConnector: TExoChildrenPort; stages: TExoChildrenPort; noStagesHidden: TExoAttrPort; summaryTone: TExoAttrPort; summary: TExoTextPort;
    resultConnector: TExoChildrenPort; resultStatus: TExoAttrPort; hops: TExoTextPort;
    attemptsHidden: TExoAttrPort; attempts: TExoChildrenPort;
}>($ => (
    <div class="exp-detail">
        <div class="exp-detail-loading" hidden={$.loadingHidden} data-tone={$.loadingTone}>{$.loading}</div>
        <div class="exp-stimulation" hidden={$.bodyHidden}>
            <div class="exp-stimulation-head">
                <div class="exp-heading eyebrow" data-tone="yellow">STIMULATION · FLOW</div>
                <div class="exp-spacer" />
                <button class="exp-action" data-tone="green" hidden={$.retryHidden} disabled={$.retryDisabled} onClick={$.retry}>{$.retryLabel}</button>
                <button class="exp-action" data-tone="cyan" hidden={$.cloneHidden} disabled={$.cloneDisabled} onClick={$.clone}>{$.cloneLabel}</button>
            </div>
            <div class="exp-stimulation-id">{$.stimulationId}</div>
            <div class="exp-toast" hidden={$.toastHidden} data-tone={$.toastTone}>{$.toast}</div>
            <div class="exp-pipeline">
                <div class="exp-pipeline-end" data-tone="violet">
                    <div class="exp-heading eyebrow exp-tone-text">ENTRY</div>
                    <div class="exp-pipeline-entry-name">{$.entryName}</div>
                    <div class="exp-pipeline-end-caption">{$.attemptCount}</div>
                </div>
                <$.entryConnector />
                <div class="exp-pipeline-stages">
                    <div class="exp-pipeline-stage-row">
                        <$.stages />
                        <span class="exp-detail-caption" hidden={$.noStagesHidden}>no hops recorded</span>
                    </div>
                    <div class="exp-pipeline-summary" data-tone={$.summaryTone}>{$.summary}</div>
                </div>
                <$.resultConnector />
                <div class="exp-pipeline-end exp-pipeline-result" data-status={$.resultStatus}>
                    <div class="exp-heading eyebrow exp-status-text">RESULT</div>
                    <div class="exp-pipeline-result-pill">
                        <span class="status-pill" data-status={$.pillStatus}>
                            <span class="exp-status-dot" />
                            <span>{$.pillText}</span>
                        </span>
                    </div>
                    <div class="exp-pipeline-end-caption">{$.hops}</div>
                </div>
            </div>
            <div class="exp-attempts" hidden={$.attemptsHidden}>
                <div class="exp-heading eyebrow" data-tone="violet">ATTEMPTS</div>
                <$.attempts />
            </div>
        </div>
    </div>
));
const StimulationDetailPorts = stimulationDetailSchema.ports;

const { setStage } = stageMachine.transitions;
const { setAttempt } = attemptLineMachine.transitions;

const stimulationDetailBase = createExoMachine(stimulationDetailSchema, {
    createInitialState: (c: TCNSDevToolsNode, stimulationId: string) => {
        c.one(StimulationDetailPorts.entryConnector, pipeConnectorMachine, { status: 'entry', isFlowing: true });
        return {
            stimulationId,
            stages: c.keyedList(StimulationDetailPorts.stages, (stage: TCNSStage) => CNSTaskKey.of(stage.task), stage => c.build(stageMachine, stage), setStage),
            attempts: c.keyedList(StimulationDetailPorts.attempts, (attempt: TCNSStimulationAttempt) => attempt.attemptNumber, attempt => c.build(attemptLineMachine, attempt), setAttempt),
            resultConnector: c.one(StimulationDetailPorts.resultConnector, pipeConnectorMachine, { status: 'running', isFlowing: true }),
        };
    },
});

function showStimulationDetail(c: TExoMachineNodeOf<typeof stimulationDetailBase>): void {
    const state = c.state;
    const detail = CNSExplorerReads.detailOf(c, state.stimulationId);
    c.attr(StimulationDetailPorts.loadingHidden, detail !== undefined);
    c.attr(StimulationDetailPorts.bodyHidden, detail === undefined);
    if (detail === undefined) {
        const homeostasis = CNSExplorerReads.stimulationDetailHomeostasisOf(c, state.stimulationId);
        const isFailed = homeostasis.status === ECNSHomeostatCorrectionStatus.Failed;
        c.attr(StimulationDetailPorts.loadingTone, isFailed ? 'red' : 'muted');
        c.text(StimulationDetailPorts.loading, isFailed ? `Could not load the stimulation: ${CNSErrorMessage.of(homeostasis.error)}` : 'Loading stimulation…');
        return;
    }
    const action = CNSExplorerReads.actionFeedbackOf(c);
    const pending = action?.pending ?? null;
    const lastAttempt = latestAttemptOf(detail);
    const isRetryable = lastAttempt !== undefined && (lastAttempt.status === 'failed' || lastAttempt.status === 'aborted' || lastAttempt.hasError);
    c.attr(StimulationDetailPorts.retryHidden, !CNSExplorerReads.isStimulationActionAllowed(c, 'retry'));
    c.attr(StimulationDetailPorts.retryDisabled, !isRetryable || pending !== null);
    c.text(StimulationDetailPorts.retryLabel, pending === 'retry' ? 'Retrying…' : 'Retry');
    c.attr(StimulationDetailPorts.cloneHidden, !CNSExplorerReads.isStimulationActionAllowed(c, 'clone'));
    c.attr(StimulationDetailPorts.cloneDisabled, pending !== null);
    c.text(StimulationDetailPorts.cloneLabel, pending === 'clone' ? 'Cloning…' : 'Clone');
    c.text(StimulationDetailPorts.stimulationId, state.stimulationId);
    const toast = action?.notice ? `✓ ${action.notice}` : action?.error ? `✕ ${action.error}` : '';
    c.attr(StimulationDetailPorts.toastHidden, toast === '');
    c.attr(StimulationDetailPorts.toastTone, action?.notice ? 'green' : 'red');
    c.text(StimulationDetailPorts.toast, toast);
    c.text(StimulationDetailPorts.entryName, lastAttempt?.entry[0]?.collateralName ?? '—');
    c.text(StimulationDetailPorts.attemptCount, `${detail.attempts.length} attempt${detail.attempts.length > 1 ? 's' : ''}`);
    const tasks = detail.tasks.filter(task => task.stimulationAttemptId === lastAttempt?.stimulationAttemptId).sort((left, right) => left.index - right.index);
    state.stages.reconcile(tasks.map((task, i) => ({ task, isFirst: i === 0 })));
    c.attr(StimulationDetailPorts.noStagesHidden, tasks.length > 0);
    const failedAt = tasks.findIndex(task => !!task.error);
    c.attr(StimulationDetailPorts.summaryTone, failedAt >= 0 ? 'red' : 'muted');
    c.text(StimulationDetailPorts.summary, failedAt >= 0 ? `⌐ failed at stage ${CNSTaskKey.stageOf(tasks[failedAt].index)} · ${tasks[failedAt].neuronName}` : `${tasks.length} activation tasks`);
    const resultStatus: ECNSStimulationStatus = lastAttempt === undefined ? 'running' : lastAttempt.hasError && lastAttempt.status !== 'aborted' ? 'failed' : lastAttempt.status;
    wireExoNode(state.resultConnector, pipeConnectorMachine, { status: resultStatus, isFlowing: resultStatus !== 'failed' });
    c.attr(StimulationDetailPorts.resultStatus, resultStatus);
    CNSStatusPill.show(c, StimulationDetailPorts, resultStatus);
    c.text(StimulationDetailPorts.hops, `${lastAttempt?.hopCount ?? detail.tasks.length} hops`);
    c.attr(StimulationDetailPorts.attemptsHidden, detail.attempts.length <= 1);
    state.attempts.reconcile(detail.attempts.length > 1 ? detail.attempts : []);
}

export const stimulationDetailMachine = composeExoMachine(
    stimulationDetailBase,
    m => withCNSReceptors(m, receptor => {
        receptor(StimulationDetailPorts.retry, explorerUiAxon.stimulationRetryRequested, c => ({ stimulationId: c.state.stimulationId }));
        receptor(StimulationDetailPorts.clone, explorerUiAxon.stimulationCloneRequested, c => ({ stimulationId: c.state.stimulationId }));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showStimulationDetail(c));
    })
);
