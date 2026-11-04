import type { TCNSDevToolsConnection } from './types/TCNSDevToolsConnection';
import type { TCNSStimulationActionName } from './types/TCNSStimulationActionName';

export function isStimulationActionAllowed(connection: TCNSDevToolsConnection | undefined, actionName: TCNSStimulationActionName): boolean {
    if (connection?.isReadOnly === true) return false;
    if (actionName === 'retry' || actionName === 'clone') return connection?.uiConfig.actions?.[actionName] !== false;
    return true;
}
