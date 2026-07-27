import { z } from 'zod';

/**
 * The name-based observability view of one stimulation: its status + resumable
 * frontier + full attempt/task history (the waterfall). This is the server's
 * projection of the durable `ICNSStimulationRepository` (Stimulation → Attempt →
 * Task, all by name) into the shape the panel renders. `runId` is the stable
 * `stimulationId`. Mirrors the admin `TRunSummary` so the same panel UI renders
 * both the WS observability stream and the HTTP admin.
 */
export const CNSDTORunViewSchema = z.object({
    runId: z.string(),
    status: z.string(),
    scopeName: z.string().optional(),
    entry: z.object({ collateralName: z.string(), payload: z.unknown() }),
    /** Neuron names still outstanding — non-empty ⇒ retry can resume. */
    frontier: z.array(z.string()),
    attempts: z.array(
        z.object({
            attemptNumber: z.number(),
            status: z.string(),
            hopCount: z.number(),
            startedAt: z.number().optional(),
            completedAt: z.number().nullable().optional(),
            tasks: z.array(
                z.object({
                    index: z.number(),
                    neuronName: z.string(),
                    /** Input collateral name (the dendrite this task fired on). */
                    dendriteCollateralName: z.string().optional(),
                    status: z.string(),
                    output: z
                        .object({
                            collateralName: z.string(),
                            payload: z.unknown(),
                        })
                        .nullable(),
                    error: z.string().nullable(),
                    startedAt: z.number().optional(),
                    duration: z.number().nullable().optional(),
                })
            ),
        })
    ),
});

export type CNSDTORunView = z.infer<typeof CNSDTORunViewSchema>;
