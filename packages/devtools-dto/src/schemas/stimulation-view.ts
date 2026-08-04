import { z } from 'zod';
import { CNSSignalJSONSchema } from './signal';

/**
 * DEPRECATED (retiring): the nested observability view of one stimulation. Replaced
 * by the flat-bucket explorer protocol (`cns.stimulations.list`/`.snapshot`/
 * `.detail`). Kept only until the last consumer (the legacy Stimulations page) is
 * removed. The canonical signal leaf now lives in `./signal`.
 */

/**
 * One neuron step (task) of an attempt, by name — the server's denormalized
 * RENDER projection of the durable `TCNSStimulationTask` (drops `inputIndex` /
 * `stimulationAttemptId`; the panel shows the input by its collateral name). This
 * is the panel's hop shape too — the panel stores these flat (keyed by stimulation
 * + attempt + index), reusing this type rather than re-deriving an id-based copy.
 */
export const CNSStimulationTaskViewDTOSchema = z.object({
    index: z.number(),
    neuronName: z.string(),
    /** Input collateral name (the dendrite this task fired on). */
    dendriteCollateralName: z.string().optional(),
    status: z.string(),
    output: CNSSignalJSONSchema.nullable(),
    error: z.string().nullable(),
    startedAt: z.number().optional(),
    duration: z.number().nullable().optional(),
});

export const CNSStimulationAttemptViewDTOSchema = z.object({
    attemptNumber: z.number(),
    status: z.string(),
    hopCount: z.number(),
    startedAt: z.number().optional(),
    completedAt: z.number().nullable().optional(),
    tasks: z.array(CNSStimulationTaskViewDTOSchema),
});

export const CNSStimulationViewDTOSchema = z.object({
    stimulationId: z.string(),
    status: z.string(),
    scopeName: z.string().optional(),
    entry: CNSSignalJSONSchema,
    /** Neuron names still outstanding — non-empty ⇒ retry can resume. */
    frontier: z.array(z.string()),
    attempts: z.array(CNSStimulationAttemptViewDTOSchema),
});

/** Re-exported canonical signal leaf (persist-dto) — one shape across all layers. */
export type { TCNSSignalJSON } from '@cnstra/persist-dto';
export type TCNSStimulationTaskViewDTO = z.infer<
    typeof CNSStimulationTaskViewDTOSchema
>;
export type TCNSStimulationAttemptViewDTO = z.infer<
    typeof CNSStimulationAttemptViewDTOSchema
>;
export type TCNSStimulationViewDTO = z.infer<typeof CNSStimulationViewDTOSchema>;
