import { z } from 'zod';
import type {
    TCNSScheduledStimulationPage,
    TCNSStimulationAttempt,
    TCNSStimulationRosterFacets,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterRow,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';
import type { TCNSAppDTO, TCNSCollateralDTO, TCNSDendriteDTO, TCNSNeuronDTO } from './entities';

export const CNS_DEVTOOLS_SYNC_PATH = '/__cnstra/sync';

const textPart = z.string().optional();
const timePart = z.number().optional();
const stimulationFilterParts = [textPart, textPart, textPart, textPart, textPart, timePart, timePart] as const;

export const CNSDevToolsSyncKeySchemas = {
    apps: z.tuple([textPart]),
    topology: z.tuple([textPart]),
    stimulationPage: z.tuple([...stimulationFilterParts, textPart, textPart, z.number().int().positive()]),
    stimulationFacets: z.tuple([...stimulationFilterParts, textPart]),
    stimulationSnapshot: z.tuple([...stimulationFilterParts, z.number().int().positive()]),
    stimulationDetail: z.tuple([z.string()]),
    scheduledPage: z.tuple([textPart, textPart, textPart, z.number().int().positive()]),
};

export type TCNSDevToolsSyncReceptorName = keyof typeof CNSDevToolsSyncKeySchemas;

export type TCNSDevToolsSyncKeys = {
    [TName in TCNSDevToolsSyncReceptorName]: z.infer<(typeof CNSDevToolsSyncKeySchemas)[TName]>;
};

export type TCNSDevToolsSyncData = {
    apps: { apps: TCNSAppDTO[] };
    topology: { neurons: TCNSNeuronDTO[]; collaterals: TCNSCollateralDTO[]; dendrites: TCNSDendriteDTO[] };
    stimulationPage: TCNSStimulationRosterPage;
    stimulationFacets: TCNSStimulationRosterFacets;
    stimulationSnapshot: { stimulations: TCNSStimulationRosterRow[] };
    stimulationDetail: { attempts: TCNSStimulationAttempt[]; tasks: TCNSStimulationTask[] };
    scheduledPage: TCNSScheduledStimulationPage & { available: boolean };
};
