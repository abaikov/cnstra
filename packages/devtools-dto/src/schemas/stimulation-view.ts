import { z } from 'zod';
import type { TCNSSignalJSON } from '@cnstra/persist-dto';

/**
 * The name-based observability view of one stimulation: its status + resumable
 * frontier + full attempt/task history (the waterfall). This is the server's
 * projection of the durable `ICNSStimulationRepository` (Stimulation → Attempt →
 * Task, all by name) into the shape the panel renders, keyed by the stable
 * `stimulationId`. The same panel UI renders both the WS observability stream and
 * the HTTP admin.
 */
/**
 * Wire validator for the canonical signal leaf. Its inferred type IS
 * `TCNSSignalJSON` (persist-dto) — the ONE signal shape shared by the durable
 * model, this wire view, and the panel. No parallel `…ViewDTO` signal type.
 */
export const CNSSignalJSONSchema: z.ZodType<TCNSSignalJSON> = z.object({
    collateralName: z.string(),
    payload: z.unknown(),
});

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
