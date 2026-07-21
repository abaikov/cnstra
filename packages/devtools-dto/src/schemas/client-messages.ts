import { z } from 'zod';
import { CNSDTOStimulationFilterSchema, CNSDTOHopFilterSchema } from './filters';

export const CNSDTOClientConnectMessageSchema = z.object({
    type: z.literal('client.connect'),
});

export const CNSDTOAppsQuerySchema = z.object({
    type: z.literal('apps.query'),
    requestId: z.string(),
});

export const CNSDTOTopologyQuerySchema = z.object({
    type: z.literal('topology.query'),
    requestId: z.string(),
    cnsId: z.string().optional(),
    appId: z.string().optional(),
});

export const CNSDTOStimulationsQuerySchema = z.object({
    type: z.literal('stimulations.query'),
    requestId: z.string(),
    appId: z.string().optional(),
    cnsId: z.string().optional(),
    filter: CNSDTOStimulationFilterSchema,
});

export const CNSDTOHopsQuerySchema = z.object({
    type: z.literal('hops.query'),
    requestId: z.string(),
    stimulationId: z.string(),
    filter: CNSDTOHopFilterSchema.optional(),
});

export const CNSDTOReplayOptionsSchema = z.object({
    maxHops: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    allowedNeuronIds: z.array(z.string()).optional(),
});

export const CNSDTOReplayStartMessageSchema = z.object({
    type: z.literal('replay.start'),
    replayId: z.string(),
    stimulationId: z.string(),
    collateralId: z.string(),
    payload: z.unknown(),
    appId: z.string().optional(),
    cnsId: z.string().optional(),
    options: CNSDTOReplayOptionsSchema.optional(),
});

export const CNSDTOClientMessageSchema = z.discriminatedUnion('type', [
    CNSDTOClientConnectMessageSchema,
    CNSDTOAppsQuerySchema,
    CNSDTOTopologyQuerySchema,
    CNSDTOStimulationsQuerySchema,
    CNSDTOHopsQuerySchema,
    CNSDTOReplayStartMessageSchema,
]);

export type CNSDTOClientConnectMessage = z.infer<typeof CNSDTOClientConnectMessageSchema>;
export type CNSDTOAppsQuery = z.infer<typeof CNSDTOAppsQuerySchema>;
export type CNSDTOTopologyQuery = z.infer<typeof CNSDTOTopologyQuerySchema>;
export type CNSDTOStimulationsQuery = z.infer<typeof CNSDTOStimulationsQuerySchema>;
export type CNSDTOHopsQuery = z.infer<typeof CNSDTOHopsQuerySchema>;
export type CNSDTOReplayOptions = z.infer<typeof CNSDTOReplayOptionsSchema>;
export type CNSDTOReplayStartMessage = z.infer<typeof CNSDTOReplayStartMessageSchema>;
export type CNSDTOClientMessage = z.infer<typeof CNSDTOClientMessageSchema>;
