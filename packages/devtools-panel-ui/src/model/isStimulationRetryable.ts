import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';
import { latestAttemptOf } from './latestAttemptOf';

export function isStimulationRetryable(detail: TCNSDevToolsSyncData['stimulationDetail'] | undefined): boolean {
    const latestAttempt = latestAttemptOf(detail);
    return latestAttempt !== undefined && (latestAttempt.status === 'failed' || latestAttempt.status === 'aborted' || latestAttempt.hasError);
}
