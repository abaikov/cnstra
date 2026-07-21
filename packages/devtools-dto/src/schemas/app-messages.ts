import { z } from 'zod';
import { CNSDTOCollateralSchema, CNSDTODendriteSchema, CNSDTOStimulationSchema, CNSDTOHopSchema, CNSDTONeuronSchema } from './entities';

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

export const CNSDTOStimulationStartedMessageSchema = z.object({
    type: z.literal('stimulation.started'),
    stimulation: CNSDTOStimulationSchema,
});

export const CNSDTOHopAddedMessageSchema = z.object({
    type: z.literal('stimulation.hop'),
    hop: CNSDTOHopSchema,
});

export const CNSDTOStimulationCompletedMessageSchema = z.object({
    type: z.literal('stimulation.completed'),
    stimulationId: z.string(),
    completedAt: z.number(),
    hopCount: z.number().int().nonnegative(),
    hasError: z.boolean(),
});

export const CNSDTOAppBatchItemSchema = z.discriminatedUnion('type', [
    CNSDTOTopologyMessageSchema,
    CNSDTOStimulationStartedMessageSchema,
    CNSDTOHopAddedMessageSchema,
    CNSDTOStimulationCompletedMessageSchema,
]);

export const CNSDTOAppBatchMessageSchema = z.object({
    type: z.literal('batch'),
    items: z.array(CNSDTOAppBatchItemSchema),
});

export type CNSDTOTopologyMessage = z.infer<typeof CNSDTOTopologyMessageSchema>;
export type CNSDTOStimulationStartedMessage = z.infer<typeof CNSDTOStimulationStartedMessageSchema>;
export type CNSDTOHopAddedMessage = z.infer<typeof CNSDTOHopAddedMessageSchema>;
export type CNSDTOStimulationCompletedMessage = z.infer<typeof CNSDTOStimulationCompletedMessageSchema>;
export type CNSDTOAppBatchItem = z.infer<typeof CNSDTOAppBatchItemSchema>;
export type CNSDTOAppBatchMessage = z.infer<typeof CNSDTOAppBatchMessageSchema>;
