import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';
import type { TCNSStimulationAttempt } from '@cnstra/persist-dto';

export function latestAttemptOf(detail: TCNSDevToolsSyncData['stimulationDetail'] | undefined): TCNSStimulationAttempt | undefined {
    let latestAttempt: TCNSStimulationAttempt | undefined;
    for (const attempt of detail?.attempts ?? []) {
        if (latestAttempt === undefined || attempt.attemptNumber > latestAttempt.attemptNumber) latestAttempt = attempt;
    }
    return latestAttempt;
}
