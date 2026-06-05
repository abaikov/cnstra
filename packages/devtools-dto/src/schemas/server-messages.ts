import { z } from 'zod';
import { CNSDTOAppSchema, CNSDTOCollateralSchema, CNSDTODendriteSchema, CNSDTOExecutionSchema, CNSDTOHopSchema, CNSDTONeuronSchema } from './entities';
import { CNSDTOExecutionStartedMessageSchema, CNSDTOExecutionCompletedMessageSchema, CNSDTOHopAddedMessageSchema, CNSDTOTopologyMessageSchema } from './app-messages';

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

export const CNSDTOExecutionsResultSchema = z.object({
    type: z.literal('executions.result'),
    requestId: z.string(),
    items: z.array(CNSDTOExecutionSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
});

export const CNSDTOHopsResultSchema = z.object({
    type: z.literal('hops.result'),
    requestId: z.string(),
    items: z.array(CNSDTOHopSchema),
});

export const CNSDTOReplayAcceptedSchema = z.object({
    type: z.literal('replay.accepted'),
    replayId: z.string(),
    newExecutionId: z.string(),
});

export const CNSDTOReplayRejectedSchema = z.object({
    type: z.literal('replay.rejected'),
    replayId: z.string(),
    reason: z.string(),
});

// ─── Full server message union ────────────────────────────────────────────────

export const CNSDTOServerMessageSchema = z.discriminatedUnion('type', [
    CNSDTOAppConnectedBroadcastSchema,
    CNSDTOAppDisconnectedBroadcastSchema,
    CNSDTOServerMetricsBroadcastSchema,
    CNSDTOExecutionStartedMessageSchema,
    CNSDTOHopAddedMessageSchema,
    CNSDTOExecutionCompletedMessageSchema,
    CNSDTOTopologyMessageSchema,
    CNSDTOAppsResultSchema,
    CNSDTOTopologyResultSchema,
    CNSDTOExecutionsResultSchema,
    CNSDTOHopsResultSchema,
    CNSDTOReplayAcceptedSchema,
    CNSDTOReplayRejectedSchema,
]);

export type CNSDTOAppConnectedBroadcast = z.infer<typeof CNSDTOAppConnectedBroadcastSchema>;
export type CNSDTOAppDisconnectedBroadcast = z.infer<typeof CNSDTOAppDisconnectedBroadcastSchema>;
export type CNSDTOServerMetricsBroadcast = z.infer<typeof CNSDTOServerMetricsBroadcastSchema>;
export type CNSDTOAppsResult = z.infer<typeof CNSDTOAppsResultSchema>;
export type CNSDTOTopologyResult = z.infer<typeof CNSDTOTopologyResultSchema>;
export type CNSDTOExecutionsResult = z.infer<typeof CNSDTOExecutionsResultSchema>;
export type CNSDTOHopsResult = z.infer<typeof CNSDTOHopsResultSchema>;
export type CNSDTOReplayAccepted = z.infer<typeof CNSDTOReplayAcceptedSchema>;
export type CNSDTOReplayRejected = z.infer<typeof CNSDTOReplayRejectedSchema>;
export type CNSDTOServerMessage = z.infer<typeof CNSDTOServerMessageSchema>;
