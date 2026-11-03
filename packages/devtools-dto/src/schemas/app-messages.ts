import { z } from 'zod';
import type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';
import { CNSCollateralDTOSchema, CNSDendriteDTOSchema, CNSNeuronDTOSchema } from './entities';

type Extends<A, _B extends A> = true;

export const CNSTopologyMessageDTOSchema = z.object({
    type: z.literal('topology'),
    cnsId: z.string(),
    appId: z.string(),
    appName: z.string(),
    version: z.string(),
    timestamp: z.number(),
    neurons: z.array(CNSNeuronDTOSchema),
    collaterals: z.array(CNSCollateralDTOSchema),
    dendrites: z.array(CNSDendriteDTOSchema),
});

// ─── Name-based resumable model (Stimulation/Attempt/Task) ──────────────────────
// The producer emits these via the SAME CNSStimulationPersistor used for resumable
// resume — the SOLE stimulation/hop emit path. The payloads carry the persist-dto
// **Persisted** entities (ids already assigned by the producer's persistor).
// Drift-guarded below so a change to the persist-dto types breaks the build here.

export const CNSStimulationItemDTOSchema = z.object({
    type: z.literal('cns.stimulation'),
    data: z.custom<TCNSStimulationState>(),
});

export const CNSStimulationAttemptItemDTOSchema = z.object({
    type: z.literal('cns.stimulation.attempt'),
    data: z.custom<TCNSStimulationAttempt>(),
});

export const CNSStimulationTaskItemDTOSchema = z.object({
    type: z.literal('cns.stimulation.task'),
    data: z.custom<TCNSStimulationTask>(),
});

type _S = Extends<TCNSStimulationState, z.infer<typeof CNSStimulationItemDTOSchema>['data']>;
type _A = Extends<TCNSStimulationAttempt, z.infer<typeof CNSStimulationAttemptItemDTOSchema>['data']>;
type _T = Extends<TCNSStimulationTask, z.infer<typeof CNSStimulationTaskItemDTOSchema>['data']>;

export const CNSAppBatchItemDTOSchema = z.discriminatedUnion('type', [
    CNSTopologyMessageDTOSchema,
    CNSStimulationItemDTOSchema,
    CNSStimulationAttemptItemDTOSchema,
    CNSStimulationTaskItemDTOSchema,
]);

export const CNSAppBatchMessageDTOSchema = z.object({
    type: z.literal('batch'),
    items: z.array(CNSAppBatchItemDTOSchema),
});

export type TCNSTopologyMessageDTO = z.infer<typeof CNSTopologyMessageDTOSchema>;
export type TCNSAppBatchItemDTO = z.infer<typeof CNSAppBatchItemDTOSchema>;
export type TCNSAppBatchMessageDTO = z.infer<typeof CNSAppBatchMessageDTOSchema>;
