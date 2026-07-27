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

/**
 * @deprecated Legacy id-based stimulation DTO. The durable model is **name-based** —
 * prefer `TCNSStimulationPersisted` / `TCNSStimulationDto` from `@cnstra/persist-dto`
 * (grouped under a stable `stimulationRunId`). Kept until the devtools stack migrates
 * off topology ids.
 */
export const CNSDTOStimulationSchema = z.object({
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
    // ── name-based run/attempt identity (expand toward @cnstra/persist-dto) ──
    /** Stable logical run this stimulation belongs to (heir of the ephemeral `id`). */
    stimulationRunId: z.string().optional(),
    /** 1-based attempt within the run. */
    attemptNumber: z.number().int().positive().optional(),
    /** Entry collateral by name (replaces the `cnsId:name` `collateralId`). */
    collateralName: z.string().optional(),
});

/**
 * @deprecated Legacy id-based hop DTO. Superseded by the name-based
 * `TCNSStimulationTaskPersisted` (a settled task with `inputIndex` dedup) in
 * `@cnstra/persist-dto`.
 */
export const CNSDTOHopSchema = z.object({
    id: z.string(),
    stimulationId: z.string(),
    index: z.number().int().nonnegative(),
    neuronId: z.string(),
    inputCollateralId: z.string(),
    outputCollateralId: z.string().nullable(),
    inputPayload: z.unknown(),
    outputPayload: z.unknown().nullable(),
    startedAt: z.number(),
    duration: z.number().nullable(),
    error: z.string().nullable(),
    // ── name-based refs (expand toward @cnstra/persist-dto TCNSStimulationTask) ──
    /** The activated neuron by name (always resolvable — resolve-or-null for now). */
    neuronName: z.string().nullable().optional(),
    /** Input (dendrite) collateral by name. */
    inputCollateralName: z.string().nullable().optional(),
    /** Output collateral by name. */
    outputCollateralName: z.string().nullable().optional(),
});

export type CNSDTOApp = z.infer<typeof CNSDTOAppSchema>;
export type CNSDTONeuron = z.infer<typeof CNSDTONeuronSchema>;
export type CNSDTOCollateral = z.infer<typeof CNSDTOCollateralSchema>;
export type CNSDTODendrite = z.infer<typeof CNSDTODendriteSchema>;
export type CNSDTOStimulation = z.infer<typeof CNSDTOStimulationSchema>;
export type CNSDTOHop = z.infer<typeof CNSDTOHopSchema>;
