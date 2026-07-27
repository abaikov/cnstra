import { z } from 'zod';
import type {
    TCNSStimulationRetryMessage,
    TCNSStimulationCloneMessage,
} from '@cnstra/persist-dto';

/** Compile-time guard: a validated message must satisfy the canonical persist-dto type. */
type Extends<A, _B extends A> = true;

export const CNSDTOClientConnectMessageSchema = z.object({
    type: z.literal('client.connect'),
});

export const CNSDTOAppsQuerySchema = z.object({
    type: z.literal('apps.query'),
    requestId: z.string(),
});

export const CNSDTOTopologyQuerySchema = z.object({
    type: z.literal('topology.query'),
    requestId: z.string(),
    cnsId: z.string().optional(),
    appId: z.string().optional(),
});

/**
 * Name-based observability query (Phase 2b-3): poll the server's durable
 * `ICNSStimulationRepository` for the Stimulation→Attempt→Task roster, optionally
 * scoped. The server replies with `cns.stimulations.result` (run views). This is
 * the name-based replacement for the legacy `stimulations.query`/`hops.query`.
 */
export const CNSDTORunsQuerySchema = z.object({
    type: z.literal('cns.stimulations.query'),
    requestId: z.string(),
    scopeName: z.string().optional(),
});


export const CNSDTOReplayOptionsSchema = z.object({
    maxHops: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    allowedNeuronIds: z.array(z.string()).optional(),
});

export const CNSDTOReplayStartMessageSchema = z.object({
    type: z.literal('replay.start'),
    replayId: z.string(),
    stimulationId: z.string(),
    collateralId: z.string(),
    payload: z.unknown(),
    appId: z.string().optional(),
    cnsId: z.string().optional(),
    options: CNSDTOReplayOptionsSchema.optional(),
});

// ─── Durable-run actions (panel → server); canonical types in @cnstra/persist-dto ──
// retry = resume the run's frontier (same run, +1 attempt); clone = fresh run from entry.
// All topology is by name — options restrict neurons by name, never id.

export const CNSDTOStimulationActionOptionsSchema = z.object({
    maxHops: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    allowedNeuronNames: z.array(z.string()).optional(),
});

export const CNSDTOStimulationRetryMessageSchema = z.object({
    type: z.literal('stimulation.retry'),
    requestId: z.string(),
    stimulationId: z.string(),
    options: CNSDTOStimulationActionOptionsSchema.optional(),
});

export const CNSDTOStimulationCloneMessageSchema = z.object({
    type: z.literal('stimulation.clone'),
    requestId: z.string(),
    stimulationId: z.string(),
    options: CNSDTOStimulationActionOptionsSchema.optional(),
});

// drift guards — these validators must match the canonical persist-dto messages
type _RetryOk = Extends<TCNSStimulationRetryMessage, z.infer<typeof CNSDTOStimulationRetryMessageSchema>>;
type _CloneOk = Extends<TCNSStimulationCloneMessage, z.infer<typeof CNSDTOStimulationCloneMessageSchema>>;

export const CNSDTOClientMessageSchema = z.discriminatedUnion('type', [
    CNSDTOClientConnectMessageSchema,
    CNSDTOAppsQuerySchema,
    CNSDTOTopologyQuerySchema,
    CNSDTORunsQuerySchema,
    CNSDTOReplayStartMessageSchema,
    CNSDTOStimulationRetryMessageSchema,
    CNSDTOStimulationCloneMessageSchema,
]);

export type CNSDTOClientConnectMessage = z.infer<typeof CNSDTOClientConnectMessageSchema>;
export type CNSDTOAppsQuery = z.infer<typeof CNSDTOAppsQuerySchema>;
export type CNSDTOTopologyQuery = z.infer<typeof CNSDTOTopologyQuerySchema>;
export type CNSDTORunsQuery = z.infer<typeof CNSDTORunsQuerySchema>;
export type CNSDTOReplayOptions = z.infer<typeof CNSDTOReplayOptionsSchema>;
export type CNSDTOReplayStartMessage = z.infer<typeof CNSDTOReplayStartMessageSchema>;
export type CNSDTOStimulationActionOptions = z.infer<typeof CNSDTOStimulationActionOptionsSchema>;
export type CNSDTOStimulationRetryMessage = z.infer<typeof CNSDTOStimulationRetryMessageSchema>;
export type CNSDTOStimulationCloneMessage = z.infer<typeof CNSDTOStimulationCloneMessageSchema>;
export type CNSDTOClientMessage = z.infer<typeof CNSDTOClientMessageSchema>;
