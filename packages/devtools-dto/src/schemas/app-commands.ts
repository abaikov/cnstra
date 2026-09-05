import { z } from 'zod';
import type { TCNSProgress, TCNSSignalJSON } from '@cnstra/persist-dto';
import { CNSStimulationActionOptionsDTOSchema } from './client-messages';

/**
 * Server→app resumable-action commands (Phase 2b-2).
 *
 * The UI sends the THIN `stimulation.retry` / `stimulation.clone` (just a
 * `stimulationId` + options). The server can't execute them — the CNS and its
 * name→ref registry live in the app — so it ENRICHES the request from the resumable
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
export const CNSStimulationResumeCommandDTOSchema = z.object({
    type: z.literal('cns.stimulation.resume'),
    requestId: z.string(),
    scopeName: z.string().optional(),
    stimulationId: z.string(),
    stimulationAttemptId: z.string(),
    attemptNumber: z.number().int().positive(),
    // The stimulation's original entry (the persistor preserves it across attempts).
    entry: z.custom<TCNSSignalJSON>(),
    // Outstanding frontier to hydrate against the app's registry and `cns.activate`.
    progress: z.custom<TCNSProgress>(),
    options: CNSStimulationActionOptionsDTOSchema.optional(),
});

/** Clone: a fresh stimulation (new id, attempt 1) re-fired from the source entry. */
export const CNSStimulationLaunchCommandDTOSchema = z.object({
    type: z.literal('cns.stimulation.launch'),
    requestId: z.string(),
    scopeName: z.string().optional(),
    stimulationId: z.string(),
    stimulationAttemptId: z.string(),
    entry: z.custom<TCNSSignalJSON>(),
    options: CNSStimulationActionOptionsDTOSchema.optional(),
});

export const CNSAppCommandDTOSchema = z.discriminatedUnion('type', [
    CNSStimulationResumeCommandDTOSchema,
    CNSStimulationLaunchCommandDTOSchema,
]);

export type TCNSStimulationResumeCommandDTO = z.infer<
    typeof CNSStimulationResumeCommandDTOSchema
>;
export type TCNSStimulationLaunchCommandDTO = z.infer<
    typeof CNSStimulationLaunchCommandDTOSchema
>;
export type TCNSAppCommandDTO = z.infer<typeof CNSAppCommandDTOSchema>;

// Drift guards: the enriched commands must carry the canonical persist-dto shapes.
type _Resume = Extends<
    TCNSProgress,
    z.infer<typeof CNSStimulationResumeCommandDTOSchema>['progress']
>;
type _Entry = Extends<
    TCNSSignalJSON,
    z.infer<typeof CNSStimulationLaunchCommandDTOSchema>['entry']
>;
