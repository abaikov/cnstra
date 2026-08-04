import { z } from 'zod';
import { CNSAppDTOSchema, CNSCollateralDTOSchema, CNSDendriteDTOSchema, CNSNeuronDTOSchema } from './entities';
import type {
    TCNSStimulationRetryAccepted,
    TCNSStimulationRetryRejected,
    TCNSStimulationCloneAccepted,
    TCNSStimulationCloneRejected,
} from '@cnstra/persist-dto';

type Extends<A, _B extends A> = true;
import { CNSTopologyMessageDTOSchema } from './app-messages';
import { CNSStimulationViewDTOSchema } from './stimulation-view';

/**
 * Name-based observability result (Phase 2b-3): the run/attempt/task roster the
 * panel renders, projected from the server's `ICNSStimulationRepository`. Replaces
 * the legacy `stimulations.result` + `hops.result` pair.
 */
export const CNSStimulationsResultDTOSchema = z.object({
    type: z.literal('cns.stimulations.result'),
    requestId: z.string(),
    stimulations: z.array(CNSStimulationViewDTOSchema),
});
export type TCNSStimulationsResultDTO = z.infer<typeof CNSStimulationsResultDTOSchema>;

// ─── Broadcasts (server → all connected UI clients) ───────────────────────────

export const CNSAppConnectedBroadcastDTOSchema = z.object({
    type: z.literal('app.connected'),
    app: CNSAppDTOSchema,
    topology: z.object({
        cnsId: z.string(),
        neurons: z.array(CNSNeuronDTOSchema),
        collaterals: z.array(CNSCollateralDTOSchema),
        dendrites: z.array(CNSDendriteDTOSchema),
    }),
});

export const CNSAppDisconnectedBroadcastDTOSchema = z.object({
    type: z.literal('app.disconnected'),
    appId: z.string(),
});

export const CNSServerMetricsBroadcastDTOSchema = z.object({
    type: z.literal('server.metrics'),
    timestamp: z.number(),
    rssMB: z.number(),
    heapUsedMB: z.number(),
    heapTotalMB: z.number(),
    cpuPercent: z.number(),
});

// ─── Query results (server → requesting UI client, matched by requestId) ──────

export const CNSAppsResultDTOSchema = z.object({
    type: z.literal('apps.result'),
    requestId: z.string(),
    items: z.array(CNSAppDTOSchema),
});

export const CNSTopologyResultDTOSchema = z.object({
    type: z.literal('topology.result'),
    requestId: z.string(),
    snapshots: z.array(z.object({
        cnsId: z.string(),
        appId: z.string(),
        neurons: z.array(CNSNeuronDTOSchema),
        collaterals: z.array(CNSCollateralDTOSchema),
        dendrites: z.array(CNSDendriteDTOSchema),
    })),
});

export const CNSReplayAcceptedDTOSchema = z.object({
    type: z.literal('replay.accepted'),
    replayId: z.string(),
    newStimulationId: z.string(),
});

export const CNSReplayRejectedDTOSchema = z.object({
    type: z.literal('replay.rejected'),
    replayId: z.string(),
    reason: z.string(),
});

// ─── Durable-run action results (matched by requestId); types in @cnstra/persist-dto ──
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

type _RA = Extends<TCNSStimulationRetryAccepted, z.infer<typeof CNSStimulationRetryAcceptedDTOSchema>>;
type _RR = Extends<TCNSStimulationRetryRejected, z.infer<typeof CNSStimulationRetryRejectedDTOSchema>>;
type _CA = Extends<TCNSStimulationCloneAccepted, z.infer<typeof CNSStimulationCloneAcceptedDTOSchema>>;
type _CR = Extends<TCNSStimulationCloneRejected, z.infer<typeof CNSStimulationCloneRejectedDTOSchema>>;

// ─── Full server message union ────────────────────────────────────────────────

export const CNSServerMessageDTOSchema = z.discriminatedUnion('type', [
    CNSAppConnectedBroadcastDTOSchema,
    CNSAppDisconnectedBroadcastDTOSchema,
    CNSServerMetricsBroadcastDTOSchema,
    CNSTopologyMessageDTOSchema,
    CNSAppsResultDTOSchema,
    CNSTopologyResultDTOSchema,
    CNSReplayAcceptedDTOSchema,
    CNSReplayRejectedDTOSchema,
    CNSStimulationRetryAcceptedDTOSchema,
    CNSStimulationRetryRejectedDTOSchema,
    CNSStimulationCloneAcceptedDTOSchema,
    CNSStimulationCloneRejectedDTOSchema,
    CNSStimulationsResultDTOSchema,
]);

export type TCNSAppConnectedBroadcastDTO = z.infer<typeof CNSAppConnectedBroadcastDTOSchema>;
export type TCNSAppDisconnectedBroadcastDTO = z.infer<typeof CNSAppDisconnectedBroadcastDTOSchema>;
export type TCNSServerMetricsBroadcastDTO = z.infer<typeof CNSServerMetricsBroadcastDTOSchema>;
export type TCNSAppsResultDTO = z.infer<typeof CNSAppsResultDTOSchema>;
export type TCNSTopologyResultDTO = z.infer<typeof CNSTopologyResultDTOSchema>;
export type TCNSReplayAcceptedDTO = z.infer<typeof CNSReplayAcceptedDTOSchema>;
export type TCNSReplayRejectedDTO = z.infer<typeof CNSReplayRejectedDTOSchema>;
export type TCNSStimulationRetryAcceptedDTO = z.infer<typeof CNSStimulationRetryAcceptedDTOSchema>;
export type TCNSStimulationRetryRejectedDTO = z.infer<typeof CNSStimulationRetryRejectedDTOSchema>;
export type TCNSStimulationCloneAcceptedDTO = z.infer<typeof CNSStimulationCloneAcceptedDTOSchema>;
export type TCNSStimulationCloneRejectedDTO = z.infer<typeof CNSStimulationCloneRejectedDTOSchema>;
export type TCNSServerMessageDTO = z.infer<typeof CNSServerMessageDTOSchema>;
