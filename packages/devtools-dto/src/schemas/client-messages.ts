import { z } from 'zod';
import type {
    TCNSStimulationRetryRequest,
    TCNSStimulationCloneRequest,
} from '@cnstra/persist-dto';

/** Compile-time guard: a validated message must satisfy the canonical persist-dto type. */
type Extends<A, _B extends A> = true;

export const CNSClientConnectMessageDTOSchema = z.object({
    type: z.literal('client.connect'),
});

export const CNSAppsQueryDTOSchema = z.object({
    type: z.literal('apps.query'),
    requestId: z.string(),
});

export const CNSTopologyQueryDTOSchema = z.object({
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
export const CNSStimulationsQueryDTOSchema = z.object({
    type: z.literal('cns.stimulations.query'),
    requestId: z.string(),
    scopeName: z.string().optional(),
});


export const CNSReplayOptionsDTOSchema = z.object({
    maxHops: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    allowedNeuronIds: z.array(z.string()).optional(),
});

export const CNSReplayStartMessageDTOSchema = z.object({
    type: z.literal('replay.start'),
    replayId: z.string(),
    stimulationId: z.string(),
    collateralId: z.string(),
    payload: z.unknown(),
    appId: z.string().optional(),
    cnsId: z.string().optional(),
    options: CNSReplayOptionsDTOSchema.optional(),
});

// ─── Durable-run actions (panel → server); canonical types in @cnstra/persist-dto ──
// retry = resume the run's frontier (same run, +1 attempt); clone = fresh run from entry.
// All topology is by name — options restrict neurons by name, never id.

export const CNSStimulationActionOptionsDTOSchema = z.object({
    maxHops: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    allowedNeuronNames: z.array(z.string()).optional(),
});

export const CNSStimulationRetryMessageDTOSchema = z.object({
    type: z.literal('stimulation.retry'),
    requestId: z.string(),
    stimulationId: z.string(),
    options: CNSStimulationActionOptionsDTOSchema.optional(),
});

export const CNSStimulationCloneMessageDTOSchema = z.object({
    type: z.literal('stimulation.clone'),
    requestId: z.string(),
    stimulationId: z.string(),
    options: CNSStimulationActionOptionsDTOSchema.optional(),
});

// drift guards — these validators must match the canonical persist-dto messages
type _RetryOk = Extends<TCNSStimulationRetryRequest, z.infer<typeof CNSStimulationRetryMessageDTOSchema>>;
type _CloneOk = Extends<TCNSStimulationCloneRequest, z.infer<typeof CNSStimulationCloneMessageDTOSchema>>;

export const CNSClientMessageDTOSchema = z.discriminatedUnion('type', [
    CNSClientConnectMessageDTOSchema,
    CNSAppsQueryDTOSchema,
    CNSTopologyQueryDTOSchema,
    CNSStimulationsQueryDTOSchema,
    CNSReplayStartMessageDTOSchema,
    CNSStimulationRetryMessageDTOSchema,
    CNSStimulationCloneMessageDTOSchema,
]);

export type TCNSClientConnectMessageDTO = z.infer<typeof CNSClientConnectMessageDTOSchema>;
export type TCNSAppsQueryDTO = z.infer<typeof CNSAppsQueryDTOSchema>;
export type TCNSTopologyQueryDTO = z.infer<typeof CNSTopologyQueryDTOSchema>;
export type TCNSStimulationsQueryDTO = z.infer<typeof CNSStimulationsQueryDTOSchema>;
export type TCNSReplayOptionsDTO = z.infer<typeof CNSReplayOptionsDTOSchema>;
export type TCNSReplayStartMessageDTO = z.infer<typeof CNSReplayStartMessageDTOSchema>;
export type TCNSStimulationActionOptionsDTO = z.infer<typeof CNSStimulationActionOptionsDTOSchema>;
export type TCNSStimulationRetryMessageDTO = z.infer<typeof CNSStimulationRetryMessageDTOSchema>;
export type TCNSStimulationCloneMessageDTO = z.infer<typeof CNSStimulationCloneMessageDTOSchema>;
export type TCNSClientMessageDTO = z.infer<typeof CNSClientMessageDTOSchema>;
