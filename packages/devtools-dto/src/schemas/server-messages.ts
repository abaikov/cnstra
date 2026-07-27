import { z } from 'zod';
import { CNSDTOAppSchema, CNSDTOCollateralSchema, CNSDTODendriteSchema, CNSDTONeuronSchema } from './entities';
import type {
    TCNSStimulationRetryAcceptedMessage,
    TCNSStimulationRetryRejectedMessage,
    TCNSStimulationCloneAcceptedMessage,
    TCNSStimulationCloneRejectedMessage,
} from '@cnstra/persist-dto';

type Extends<A, _B extends A> = true;
import { CNSDTOTopologyMessageSchema } from './app-messages';
import { CNSDTORunViewSchema } from './run-view';

/**
 * Name-based observability result (Phase 2b-3): the run/attempt/task roster the
 * panel renders, projected from the server's `ICNSStimulationRepository`. Replaces
 * the legacy `stimulations.result` + `hops.result` pair.
 */
export const CNSDTORunsResultSchema = z.object({
    type: z.literal('cns.stimulations.result'),
    requestId: z.string(),
    runs: z.array(CNSDTORunViewSchema),
});
export type CNSDTORunsResult = z.infer<typeof CNSDTORunsResultSchema>;

// ─── Broadcasts (server → all connected UI clients) ───────────────────────────

export const CNSDTOAppConnectedBroadcastSchema = z.object({
    type: z.literal('app.connected'),
    app: CNSDTOAppSchema,
    topology: z.object({
        cnsId: z.string(),
        neurons: z.array(CNSDTONeuronSchema),
        collaterals: z.array(CNSDTOCollateralSchema),
        dendrites: z.array(CNSDTODendriteSchema),
    }),
});

export const CNSDTOAppDisconnectedBroadcastSchema = z.object({
    type: z.literal('app.disconnected'),
    appId: z.string(),
});

export const CNSDTOServerMetricsBroadcastSchema = z.object({
    type: z.literal('server.metrics'),
    timestamp: z.number(),
    rssMB: z.number(),
    heapUsedMB: z.number(),
    heapTotalMB: z.number(),
    cpuPercent: z.number(),
});

// ─── Query results (server → requesting UI client, matched by requestId) ──────

export const CNSDTOAppsResultSchema = z.object({
    type: z.literal('apps.result'),
    requestId: z.string(),
    items: z.array(CNSDTOAppSchema),
});

export const CNSDTOTopologyResultSchema = z.object({
    type: z.literal('topology.result'),
    requestId: z.string(),
    snapshots: z.array(z.object({
        cnsId: z.string(),
        appId: z.string(),
        neurons: z.array(CNSDTONeuronSchema),
        collaterals: z.array(CNSDTOCollateralSchema),
        dendrites: z.array(CNSDTODendriteSchema),
    })),
});

export const CNSDTOReplayAcceptedSchema = z.object({
    type: z.literal('replay.accepted'),
    replayId: z.string(),
    newStimulationId: z.string(),
});

export const CNSDTOReplayRejectedSchema = z.object({
    type: z.literal('replay.rejected'),
    replayId: z.string(),
    reason: z.string(),
});

// ─── Durable-run action results (matched by requestId); types in @cnstra/persist-dto ──
// `rejected` is the clean "unsupported for this delivery" answer (e.g. pg-boss + retry).

export const CNSDTOStimulationRetryAcceptedSchema = z.object({
    type: z.literal('stimulation.retry.accepted'),
    requestId: z.string(),
    stimulationId: z.string(),
    newStimulationAttemptId: z.string(),
});
export const CNSDTOStimulationRetryRejectedSchema = z.object({
    type: z.literal('stimulation.retry.rejected'),
    requestId: z.string(),
    stimulationId: z.string(),
    reason: z.string(),
});
export const CNSDTOStimulationCloneAcceptedSchema = z.object({
    type: z.literal('stimulation.clone.accepted'),
    requestId: z.string(),
    stimulationId: z.string(),
    newStimulationId: z.string(),
    newStimulationAttemptId: z.string(),
});
export const CNSDTOStimulationCloneRejectedSchema = z.object({
    type: z.literal('stimulation.clone.rejected'),
    requestId: z.string(),
    stimulationId: z.string(),
    reason: z.string(),
});

type _RA = Extends<TCNSStimulationRetryAcceptedMessage, z.infer<typeof CNSDTOStimulationRetryAcceptedSchema>>;
type _RR = Extends<TCNSStimulationRetryRejectedMessage, z.infer<typeof CNSDTOStimulationRetryRejectedSchema>>;
type _CA = Extends<TCNSStimulationCloneAcceptedMessage, z.infer<typeof CNSDTOStimulationCloneAcceptedSchema>>;
type _CR = Extends<TCNSStimulationCloneRejectedMessage, z.infer<typeof CNSDTOStimulationCloneRejectedSchema>>;

// ─── Full server message union ────────────────────────────────────────────────

export const CNSDTOServerMessageSchema = z.discriminatedUnion('type', [
    CNSDTOAppConnectedBroadcastSchema,
    CNSDTOAppDisconnectedBroadcastSchema,
    CNSDTOServerMetricsBroadcastSchema,
    CNSDTOTopologyMessageSchema,
    CNSDTOAppsResultSchema,
    CNSDTOTopologyResultSchema,
    CNSDTOReplayAcceptedSchema,
    CNSDTOReplayRejectedSchema,
    CNSDTOStimulationRetryAcceptedSchema,
    CNSDTOStimulationRetryRejectedSchema,
    CNSDTOStimulationCloneAcceptedSchema,
    CNSDTOStimulationCloneRejectedSchema,
    CNSDTORunsResultSchema,
]);

export type CNSDTOAppConnectedBroadcast = z.infer<typeof CNSDTOAppConnectedBroadcastSchema>;
export type CNSDTOAppDisconnectedBroadcast = z.infer<typeof CNSDTOAppDisconnectedBroadcastSchema>;
export type CNSDTOServerMetricsBroadcast = z.infer<typeof CNSDTOServerMetricsBroadcastSchema>;
export type CNSDTOAppsResult = z.infer<typeof CNSDTOAppsResultSchema>;
export type CNSDTOTopologyResult = z.infer<typeof CNSDTOTopologyResultSchema>;
export type CNSDTOReplayAccepted = z.infer<typeof CNSDTOReplayAcceptedSchema>;
export type CNSDTOReplayRejected = z.infer<typeof CNSDTOReplayRejectedSchema>;
export type CNSDTOStimulationRetryAccepted = z.infer<typeof CNSDTOStimulationRetryAcceptedSchema>;
export type CNSDTOStimulationRetryRejected = z.infer<typeof CNSDTOStimulationRetryRejectedSchema>;
export type CNSDTOStimulationCloneAccepted = z.infer<typeof CNSDTOStimulationCloneAcceptedSchema>;
export type CNSDTOStimulationCloneRejected = z.infer<typeof CNSDTOStimulationCloneRejectedSchema>;
export type CNSDTOServerMessage = z.infer<typeof CNSDTOServerMessageSchema>;
