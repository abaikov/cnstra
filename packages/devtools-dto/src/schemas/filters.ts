import { z } from 'zod';

export const CNSDTOExecutionFilterSchema = z.object({
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    fromTimestamp: z.number().optional(),
    toTimestamp: z.number().optional(),
    hasError: z.boolean().optional(),
    collateralId: z.string().optional(),
    neuronId: z.string().optional(),
});

export const CNSDTOHopFilterSchema = z.object({
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    hasError: z.boolean().optional(),
    neuronId: z.string().optional(),
});

export type CNSDTOExecutionFilter = z.infer<typeof CNSDTOExecutionFilterSchema>;
export type CNSDTOHopFilter = z.infer<typeof CNSDTOHopFilterSchema>;
