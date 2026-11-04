import { z } from 'zod';
import type {
    TCNSStimulationRetryAccepted,
    TCNSStimulationRetryRejected,
    TCNSStimulationCloneAccepted,
    TCNSStimulationCloneRejected,
    TCNSStimulationCommandAccepted,
    TCNSStimulationCommandRejected,
    TCNSStimulationLaunchAccepted,
    TCNSStimulationLaunchRejected,
} from '@cnstra/persist-dto';

type Extends<A, _B extends A> = true;
import { CNSTopologyMessageDTOSchema } from './app-messages';

// ─── Query results (server → requesting UI client, matched by requestId) ──────

/**
 * What the panel is allowed to offer, sent once on connect.
 *
 * Retry and Clone are different operations, not two buttons for one thing:
 * **Retry** continues the SAME run — the same `stimulationId`, the record is
 * updated in place. **Clone** starts a new run from the same entry and leaves
 * the original untouched. A deployment that must never overwrite a run's record
 * turns Retry off; one where a rerun must not multiply run ids turns Clone off.
 *
 * Absent flags mean allowed, so an older server that sends no config leaves the
 * panel exactly as it was.
 */
export const CNSUiConfigDTOSchema = z.object({
    type: z.literal('ui.config'),
    actions: z
        .object({
            retry: z.boolean().optional(),
            clone: z.boolean().optional(),
        })
        .optional(),
    /**
     * How far back the panel looks when it opens, in milliseconds.
     *
     * Every view in the Explorer is time-ordered, and an unbounded first query
     * makes the store aggregate its whole history to show fifty rows. A window
     * bounds that to what someone is actually looking at. `0` means no window —
     * the old behaviour, for a store small enough not to care.
     */
    defaultWindowMs: z.number().nonnegative().optional(),
});

export const CNSSyncResponseDTOSchema = z.object({
    type: z.literal('sync.response'),
    requestId: z.string(),
    status: z.number(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
});

// ─── Resumable-run action results (matched by requestId); types in @cnstra/persist-dto ──
// `rejected` is the clean "unsupported for this delivery" answer (e.g. pg-boss + retry).

export const CNSStimulationRetryAcceptedDTOSchema = z.object({
    type: z.literal('stimulation.retry.accepted'),
    requestId: z.string(),
    stimulationId: z.string(),
    newStimulationAttemptId: z.string(),
});
export const CNSStimulationRetryRejectedDTOSchema = z.object({
    type: z.literal('stimulation.retry.rejected'),
    requestId: z.string(),
    stimulationId: z.string(),
    reason: z.string(),
});
export const CNSStimulationCloneAcceptedDTOSchema = z.object({
    type: z.literal('stimulation.clone.accepted'),
    requestId: z.string(),
    stimulationId: z.string(),
    newStimulationId: z.string(),
    newStimulationAttemptId: z.string(),
});
export const CNSStimulationCloneRejectedDTOSchema = z.object({
    type: z.literal('stimulation.clone.rejected'),
    requestId: z.string(),
    stimulationId: z.string(),
    reason: z.string(),
});

export const CNSStimulationCommandAcceptedDTOSchema = z.object({
    type: z.literal('stimulation.command.accepted'),
    requestId: z.string(),
    stimulationId: z.string(),
});
export const CNSStimulationCommandRejectedDTOSchema = z.object({
    type: z.literal('stimulation.command.rejected'),
    requestId: z.string(),
    stimulationId: z.string(),
    reason: z.string(),
});
export const CNSStimulationLaunchAcceptedDTOSchema = z.object({
    type: z.literal('stimulation.launch.accepted'),
    requestId: z.string(),
    newStimulationId: z.string(),
});
export const CNSStimulationLaunchRejectedDTOSchema = z.object({
    type: z.literal('stimulation.launch.rejected'),
    requestId: z.string(),
    reason: z.string(),
});

type _RA = Extends<TCNSStimulationRetryAccepted, z.infer<typeof CNSStimulationRetryAcceptedDTOSchema>>;
type _RR = Extends<TCNSStimulationRetryRejected, z.infer<typeof CNSStimulationRetryRejectedDTOSchema>>;
type _CA = Extends<TCNSStimulationCloneAccepted, z.infer<typeof CNSStimulationCloneAcceptedDTOSchema>>;
type _CR = Extends<TCNSStimulationCloneRejected, z.infer<typeof CNSStimulationCloneRejectedDTOSchema>>;
type _MA = Extends<TCNSStimulationCommandAccepted, z.infer<typeof CNSStimulationCommandAcceptedDTOSchema>>;
type _MR = Extends<TCNSStimulationCommandRejected, z.infer<typeof CNSStimulationCommandRejectedDTOSchema>>;
type _LA = Extends<TCNSStimulationLaunchAccepted, z.infer<typeof CNSStimulationLaunchAcceptedDTOSchema>>;
type _LR = Extends<TCNSStimulationLaunchRejected, z.infer<typeof CNSStimulationLaunchRejectedDTOSchema>>;

// ─── Full server message union ────────────────────────────────────────────────

export const CNSServerMessageDTOSchema = z.discriminatedUnion('type', [
    CNSUiConfigDTOSchema,
    CNSSyncResponseDTOSchema,
    CNSTopologyMessageDTOSchema,
    CNSStimulationRetryAcceptedDTOSchema,
    CNSStimulationRetryRejectedDTOSchema,
    CNSStimulationCloneAcceptedDTOSchema,
    CNSStimulationCloneRejectedDTOSchema,
    CNSStimulationCommandAcceptedDTOSchema,
    CNSStimulationCommandRejectedDTOSchema,
    CNSStimulationLaunchAcceptedDTOSchema,
    CNSStimulationLaunchRejectedDTOSchema,
]);

export type TCNSServerMessageDTO = z.infer<typeof CNSServerMessageDTOSchema>;
