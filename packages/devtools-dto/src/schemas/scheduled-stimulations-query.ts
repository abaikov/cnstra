import { z } from 'zod';

export const CNSScheduledStimulationFilterSchema = z
    .object({
        collateralName: z.string(),
        neuronName: z.string(),
    })
    .partial();

export const CNSScheduledStimulationsListRequestSchema = z.object({
    type: z.literal('cns.scheduled.list'),
    requestId: z.string(),
    filter: CNSScheduledStimulationFilterSchema.optional(),
    cursor: z.string().optional(),
    limit: z.number().int().positive().optional(),
});
