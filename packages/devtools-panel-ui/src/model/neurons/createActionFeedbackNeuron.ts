import { neuron } from '@cnstra/core';
import type { TCNSStimulationCommand } from '@cnstra/persist-dto';
import { actionFeedbackAxon } from '../axons/actionFeedbackAxon';
import { explorerActionAxon } from '../axons/explorerActionAxon';
import { explorerUiAxon } from '../axons/explorerUiAxon';
import { IDLE_ACTION_FEEDBACK } from '../constants/IDLE_ACTION_FEEDBACK';
import { NOTICE_SHOWN_MS } from '../constants/NOTICE_SHOWN_MS';
import type { TCNSActionFeedback } from '../types/TCNSActionFeedback';
import type { TCNSHeldEntitySingle } from '../types/TCNSHeldEntitySingle';

function commandNoticeOf(stimulationId: string, command: TCNSStimulationCommand): string {
    switch (command.name) {
        case 'cancel':
            return `Cancelled ${stimulationId}`;
        case 'runNow':
            return `${stimulationId} moved to now`;
        case 'prioritize':
            return `${stimulationId} priority ${command.priority}`;
    }
}

function isNoticeWindowOver(disposalSignal: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
        if (disposalSignal.aborted) {
            resolve(false);
            return;
        }
        const abortNoticeWindow = (): void => {
            clearTimeout(noticeTimer);
            resolve(false);
        };
        const noticeTimer = setTimeout(() => {
            disposalSignal.removeEventListener('abort', abortNoticeWindow);
            resolve(true);
        }, NOTICE_SHOWN_MS);
        disposalSignal.addEventListener('abort', abortNoticeWindow, { once: true });
    });
}

export function createActionFeedbackNeuron(options: {
    actionFeedback: TCNSHeldEntitySingle<TCNSActionFeedback>;
    disposalSignal: AbortSignal;
}) {
    const currentFeedback = (): TCNSActionFeedback => options.actionFeedback.getSingleSlot().entity ?? IDLE_ACTION_FEEDBACK;
    const writeFeedback = (feedback: TCNSActionFeedback): void => {
        options.actionFeedback.writeSingleSlotContent(feedback);
    };
    let shownNoticeNumber = 0;
    const showNotice = async (feedback: TCNSActionFeedback & { notice: string }) => {
        const noticeNumber = ++shownNoticeNumber;
        writeFeedback(feedback);
        return (await isNoticeWindowOver(options.disposalSignal)) ? actionFeedbackAxon.noticeExpired.createSignal({ noticeNumber }) : undefined;
    };
    const started = (pending: string): void => writeFeedback({ pending, notice: null, error: null });
    const succeeded = (notice: string) => showNotice({ pending: null, notice, error: null });
    const failed = (error: string): void => writeFeedback({ pending: null, notice: null, error });
    return neuron(actionFeedbackAxon)
        .dendrite({ collateral: explorerActionAxon.retryStarted, response: () => started('retry') })
        .dendrite({ collateral: explorerActionAxon.cloneStarted, response: () => started('clone') })
        .dendrite({ collateral: explorerActionAxon.commandStarted, response: ({ command }) => started(command.name) })
        .dendrite({ collateral: explorerActionAxon.launchStarted, response: () => started('launch') })
        .dendrite({ collateral: explorerActionAxon.retryAccepted, response: () => succeeded('Retry accepted — resuming this run') })
        .dendrite({ collateral: explorerActionAxon.retryRejected, response: ({ error }) => failed(error) })
        .dendrite({ collateral: explorerActionAxon.cloneAccepted, response: ({ cloneStimulationId }) => succeeded(`Cloned → new run ${cloneStimulationId}`) })
        .dendrite({ collateral: explorerActionAxon.cloneRejected, response: ({ error }) => failed(error) })
        .dendrite({ collateral: explorerActionAxon.commandAccepted, response: ({ stimulationId, command }) => succeeded(commandNoticeOf(stimulationId, command)) })
        .dendrite({ collateral: explorerActionAxon.commandRejected, response: ({ error }) => failed(error) })
        .dendrite({ collateral: explorerActionAxon.launchAccepted, response: ({ stimulationId }) => succeeded(`Launched ${stimulationId}`) })
        .dendrite({ collateral: explorerActionAxon.launchRejected, response: ({ error }) => failed(error) })
        .dendrite({ collateral: explorerUiAxon.launchPayloadRejected, response: ({ error }) => writeFeedback({ pending: currentFeedback().pending, notice: null, error }) })
        .dendrite({
            collateral: explorerUiAxon.cancelConfirmationRequested,
            response: ({ stimulationId }) => showNotice({ pending: currentFeedback().pending, notice: `Press ✕ again to cancel ${stimulationId}`, error: null }),
        })
        .dendrite({
            collateral: actionFeedbackAxon.noticeExpired,
            response: ({ noticeNumber }) => {
                const feedback = currentFeedback();
                if (noticeNumber === shownNoticeNumber && feedback.notice !== null) writeFeedback({ ...feedback, notice: null });
            },
        });
}
