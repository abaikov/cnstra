import { z } from 'zod';
import type { TCNSProgress, TCNSSignalRef } from '@cnstra/persist-dto';
import { CNSDTOStimulationActionOptionsSchema } from './client-messages';

/**
 * Server→app durable-action commands (Phase 2b-2).
 *
 * The UI sends the THIN `stimulation.retry` / `stimulation.clone` (just a
 * `stimulationId` + options). The server can't execute them — the CNS and its
 * name→ref registry live in the app — so it ENRICHES the request from the durable
 * store (the stored `entry` + `progress`, plus a server-assigned attempt identity)
 * and forwards one of these commands to the owning app. The app hydrates the
 * progress against its own registry and runs `cns.activate` (resume) or
 * `cns.stimulate` (clone), re-emitting the new attempt through the normal
 * name-based batch path.
 *
 * These are transport plumbing, not part of the persisted model — they live only
 * in the devtools protocol.
 */

type Extends<A, _B extends A> = true;

/** Retry: resume the stored frontier as a NEW attempt of the SAME stimulation. */
export const CNSDTOStimulationResumeCommandSchema = z.object({
    type: z.literal('cns.stimulation.resume'),
    requestId: z.string(),
    scopeName: z.string().optional(),
    stimulationId: z.string(),
    stimulationAttemptId: z.string(),
    attemptNumber: z.number().int().positive(),
    // The stimulation's original entry (the persistor preserves it across attempts).
    entry: z.custom<TCNSSignalRef>(),
    // Frontier + context to hydrate against the app's registry and `cns.activate`.
    progress: z.custom<TCNSProgress>(),
    options: CNSDTOStimulationActionOptionsSchema.optional(),
});

/** Clone: a fresh stimulation (new id, attempt 1) re-fired from the source entry. */
export const CNSDTOStimulationLaunchCommandSchema = z.object({
    type: z.literal('cns.stimulation.launch'),
    requestId: z.string(),
    scopeName: z.string().optional(),
    stimulationId: z.string(),
    stimulationAttemptId: z.string(),
    entry: z.custom<TCNSSignalRef>(),
    options: CNSDTOStimulationActionOptionsSchema.optional(),
});

export const CNSDTOAppCommandSchema = z.discriminatedUnion('type', [
    CNSDTOStimulationResumeCommandSchema,
    CNSDTOStimulationLaunchCommandSchema,
]);

export type CNSDTOStimulationResumeCommand = z.infer<
    typeof CNSDTOStimulationResumeCommandSchema
>;
export type CNSDTOStimulationLaunchCommand = z.infer<
    typeof CNSDTOStimulationLaunchCommandSchema
>;
export type CNSDTOAppCommand = z.infer<typeof CNSDTOAppCommandSchema>;

// Drift guards: the enriched commands must carry the canonical persist-dto shapes.
type _Resume = Extends<
    TCNSProgress,
    z.infer<typeof CNSDTOStimulationResumeCommandSchema>['progress']
>;
type _Entry = Extends<
    TCNSSignalRef,
    z.infer<typeof CNSDTOStimulationLaunchCommandSchema>['entry']
>;
