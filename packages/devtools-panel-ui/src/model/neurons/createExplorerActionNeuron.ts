import { neuron } from '@cnstra/core';
import { explorerUiAxon } from '../axons/explorerUiAxon';
import { explorerActionAxon } from '../axons/explorerActionAxon';
import { CNSErrorMessage } from '../../utils/CNSErrorMessage';
import { isStimulationActionAllowed } from '../isStimulationActionAllowed';
import type { ICNSExplorerActionClient } from '../interfaces/ICNSExplorerActionClient';
import type { TCNSDevToolsConnection } from '../types/TCNSDevToolsConnection';
import type { TCNSHeldEntitySingle } from '../types/TCNSHeldEntitySingle';
import type { TCNSStimulationActionName } from '../types/TCNSStimulationActionName';
import type { TCNSStimulationActionRefusalReason } from '../types/TCNSStimulationActionRefusalReason';

export function createExplorerActionNeuron(options: {
    actionClient: ICNSExplorerActionClient;
    connection: TCNSHeldEntitySingle<TCNSDevToolsConnection>;
}) {
    let isActionRunning = false;
    const refusalReasonOf = (actionName: TCNSStimulationActionName): TCNSStimulationActionRefusalReason | undefined => {
        if (isActionRunning) return 'busy';
        if (!isStimulationActionAllowed(options.connection.getSingleSlot().entity, actionName)) return 'notAllowed';
        isActionRunning = true;
        return undefined;
    };
    const finishAction = (): void => {
        isActionRunning = false;
    };
    return neuron(explorerActionAxon)
        .dendrite({
            collateral: explorerUiAxon.stimulationRetryRequested,
            response: ({ stimulationId }, axon) => {
                const reason = refusalReasonOf('retry');
                return reason === undefined ? axon.retryStarted.createSignal({ stimulationId }) : axon.retryRefused.createSignal({ stimulationId, reason });
            },
        })
        .dendrite({
            collateral: explorerActionAxon.retryStarted,
            response: async ({ stimulationId }, axon) => {
                try {
                    await options.actionClient.retry(stimulationId);
                    return axon.retryAccepted.createSignal({ stimulationId });
                } catch (error) {
                    return axon.retryRejected.createSignal({ stimulationId, error: CNSErrorMessage.of(error) });
                } finally {
                    finishAction();
                }
            },
        })
        .dendrite({
            collateral: explorerUiAxon.stimulationCloneRequested,
            response: ({ stimulationId }, axon) => {
                const reason = refusalReasonOf('clone');
                return reason === undefined ? axon.cloneStarted.createSignal({ stimulationId }) : axon.cloneRefused.createSignal({ stimulationId, reason });
            },
        })
        .dendrite({
            collateral: explorerActionAxon.cloneStarted,
            response: async ({ stimulationId }, axon) => {
                try {
                    const cloneStimulationId = await options.actionClient.clone(stimulationId);
                    return axon.cloneAccepted.createSignal({ stimulationId, cloneStimulationId });
                } catch (error) {
                    return axon.cloneRejected.createSignal({ stimulationId, error: CNSErrorMessage.of(error) });
                } finally {
                    finishAction();
                }
            },
        })
        .dendrite({
            collateral: explorerUiAxon.stimulationCommandRequested,
            response: ({ stimulationId, command }, axon) => {
                const reason = refusalReasonOf('command');
                return reason === undefined ? axon.commandStarted.createSignal({ stimulationId, command }) : axon.commandRefused.createSignal({ stimulationId, command, reason });
            },
        })
        .dendrite({
            collateral: explorerActionAxon.commandStarted,
            response: async ({ stimulationId, command }, axon) => {
                try {
                    await options.actionClient.command(stimulationId, command);
                    return axon.commandAccepted.createSignal({ stimulationId, command });
                } catch (error) {
                    return axon.commandRejected.createSignal({ stimulationId, command, error: CNSErrorMessage.of(error) });
                } finally {
                    finishAction();
                }
            },
        })
        .dendrite({
            collateral: explorerUiAxon.stimulationLaunchRequested,
            response: ({ collateralName, payload }, axon) => {
                const reason = refusalReasonOf('launch');
                return reason === undefined ? axon.launchStarted.createSignal({ collateralName, payload }) : axon.launchRefused.createSignal({ collateralName, reason });
            },
        })
        .dendrite({
            collateral: explorerActionAxon.launchStarted,
            response: async ({ collateralName, payload }, axon) => {
                try {
                    const stimulationId = await options.actionClient.launch({ collateralName, payload });
                    return axon.launchAccepted.createSignal({ collateralName, stimulationId });
                } catch (error) {
                    return axon.launchRejected.createSignal({ collateralName, error: CNSErrorMessage.of(error) });
                } finally {
                    finishAction();
                }
            },
        });
}
