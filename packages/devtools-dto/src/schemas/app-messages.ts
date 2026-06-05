import { z } from 'zod';
import { CNSDTOCollateralSchema, CNSDTODendriteSchema, CNSDTOExecutionSchema, CNSDTOHopSchema, CNSDTONeuronSchema } from './entities';

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

export const CNSDTOExecutionStartedMessageSchema = z.object({
    type: z.literal('execution.started'),
    execution: CNSDTOExecutionSchema,
});

export const CNSDTOHopAddedMessageSchema = z.object({
    type: z.literal('execution.hop'),
    hop: CNSDTOHopSchema,
});

export const CNSDTOExecutionCompletedMessageSchema = z.object({
    type: z.literal('execution.completed'),
    executionId: z.string(),
    completedAt: z.number(),
    hopCount: z.number().int().nonnegative(),
    hasError: z.boolean(),
});

export const CNSDTOAppBatchItemSchema = z.discriminatedUnion('type', [
    CNSDTOTopologyMessageSchema,
    CNSDTOExecutionStartedMessageSchema,
    CNSDTOHopAddedMessageSchema,
    CNSDTOExecutionCompletedMessageSchema,
]);

export const CNSDTOAppBatchMessageSchema = z.object({
    type: z.literal('batch'),
    items: z.array(CNSDTOAppBatchItemSchema),
});

export type CNSDTOTopologyMessage = z.infer<typeof CNSDTOTopologyMessageSchema>;
export type CNSDTOExecutionStartedMessage = z.infer<typeof CNSDTOExecutionStartedMessageSchema>;
export type CNSDTOHopAddedMessage = z.infer<typeof CNSDTOHopAddedMessageSchema>;
export type CNSDTOExecutionCompletedMessage = z.infer<typeof CNSDTOExecutionCompletedMessageSchema>;
export type CNSDTOAppBatchItem = z.infer<typeof CNSDTOAppBatchItemSchema>;
export type CNSDTOAppBatchMessage = z.infer<typeof CNSDTOAppBatchMessageSchema>;
