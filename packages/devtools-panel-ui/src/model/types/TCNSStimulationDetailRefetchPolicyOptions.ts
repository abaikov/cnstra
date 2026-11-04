import type { ICNSHomeostatRefetchPolicy } from '@cnstra/sync';
import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';

export type TCNSStimulationDetailRefetchPolicyOptions = {
    staleTimeRefetchPolicy: ICNSHomeostatRefetchPolicy;
    stimulationDetailOf: (stimulationId: string) => TCNSDevToolsSyncData['stimulationDetail'] | undefined;
};
