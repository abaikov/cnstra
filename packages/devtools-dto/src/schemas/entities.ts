import { z } from 'zod';

export const CNSDTOAppSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    connectedAt: z.number(),
    lastSeenAt: z.number(),
});

export const CNSDTONeuronSchema = z.object({
    id: z.string(),
    name: z.string(),
    cnsId: z.string(),
    appId: z.string(),
});

export const CNSDTOCollateralSchema = z.object({
    id: z.string(),
    name: z.string(),
    neuronId: z.string(),
    cnsId: z.string(),
    appId: z.string(),
});

export const CNSDTODendriteSchema = z.object({
    id: z.string(),
    neuronId: z.string(),
    collateralId: z.string(),
    cnsId: z.string(),
    appId: z.string(),
});

export const CNSDTOExecutionSchema = z.object({
    id: z.string(),
    cnsId: z.string(),
    appId: z.string(),
    collateralId: z.string(),
    payload: z.unknown(),
    startedAt: z.number(),
    completedAt: z.number().nullable(),
    hopCount: z.number().int().nonnegative(),
    hasError: z.boolean(),
    replayOf: z.string().nullable(),
});

export const CNSDTOHopSchema = z.object({
    id: z.string(),
    executionId: z.string(),
    index: z.number().int().nonnegative(),
    neuronId: z.string(),
    inputCollateralId: z.string(),
    outputCollateralId: z.string().nullable(),
    inputPayload: z.unknown(),
    outputPayload: z.unknown().nullable(),
    startedAt: z.number(),
    duration: z.number().nullable(),
    error: z.string().nullable(),
});

export type CNSDTOApp = z.infer<typeof CNSDTOAppSchema>;
export type CNSDTONeuron = z.infer<typeof CNSDTONeuronSchema>;
export type CNSDTOCollateral = z.infer<typeof CNSDTOCollateralSchema>;
export type CNSDTODendrite = z.infer<typeof CNSDTODendriteSchema>;
export type CNSDTOExecution = z.infer<typeof CNSDTOExecutionSchema>;
export type CNSDTOHop = z.infer<typeof CNSDTOHopSchema>;
