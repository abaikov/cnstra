import { z } from 'zod';
import type {
    TCNSStimulationPersisted,
    TCNSStimulationAttemptPersisted,
    TCNSStimulationTaskPersisted,
} from '@cnstra/persist-dto';
import { CNSDTOCollateralSchema, CNSDTODendriteSchema, CNSDTONeuronSchema } from './entities';

type Extends<A, _B extends A> = true;

export const CNSDTOTopologyMessageSchema = z.object({
    type: z.literal('topology'),
    cnsId: z.string(),
    appId: z.string(),
    appName: z.string(),
    version: z.string(),
    timestamp: z.number(),
    neurons: z.array(CNSDTONeuronSchema),
    collaterals: z.array(CNSDTOCollateralSchema),
    dendrites: z.array(CNSDTODendriteSchema),
});

// ─── Name-based durable model (Stimulation/Attempt/Task) ──────────────────────
// The producer emits these via the SAME CNSStimulationPersistor used for durable
// resume — the SOLE stimulation/hop emit path. The payloads carry the persist-dto
// **Persisted** entities (ids already assigned by the producer's persistor).
// Drift-guarded below so a change to the persist-dto types breaks the build here.

export const CNSDTOStimulationItemSchema = z.object({
    type: z.literal('cns.stimulation'),
    data: z.custom<TCNSStimulationPersisted>(),
});

export const CNSDTOStimulationAttemptItemSchema = z.object({
    type: z.literal('cns.stimulation.attempt'),
    data: z.custom<TCNSStimulationAttemptPersisted>(),
});

export const CNSDTOStimulationTaskItemSchema = z.object({
    type: z.literal('cns.stimulation.task'),
    data: z.custom<TCNSStimulationTaskPersisted>(),
});

type _S = Extends<TCNSStimulationPersisted, z.infer<typeof CNSDTOStimulationItemSchema>['data']>;
type _A = Extends<TCNSStimulationAttemptPersisted, z.infer<typeof CNSDTOStimulationAttemptItemSchema>['data']>;
type _T = Extends<TCNSStimulationTaskPersisted, z.infer<typeof CNSDTOStimulationTaskItemSchema>['data']>;

export const CNSDTOAppBatchItemSchema = z.discriminatedUnion('type', [
    CNSDTOTopologyMessageSchema,
    CNSDTOStimulationItemSchema,
    CNSDTOStimulationAttemptItemSchema,
    CNSDTOStimulationTaskItemSchema,
]);

export const CNSDTOAppBatchMessageSchema = z.object({
    type: z.literal('batch'),
    items: z.array(CNSDTOAppBatchItemSchema),
});

export type CNSDTOTopologyMessage = z.infer<typeof CNSDTOTopologyMessageSchema>;
export type CNSDTOStimulationItem = z.infer<typeof CNSDTOStimulationItemSchema>;
export type CNSDTOStimulationAttemptItem = z.infer<typeof CNSDTOStimulationAttemptItemSchema>;
export type CNSDTOStimulationTaskItem = z.infer<typeof CNSDTOStimulationTaskItemSchema>;
export type CNSDTOAppBatchItem = z.infer<typeof CNSDTOAppBatchItemSchema>;
export type CNSDTOAppBatchMessage = z.infer<typeof CNSDTOAppBatchMessageSchema>;
