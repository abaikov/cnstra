import { z } from 'zod';
import type {
    TCNSStimulationRetryRequest,
    TCNSStimulationCloneRequest,
    TCNSStimulationCommand,
    TCNSStimulationCommandRequest,
    TCNSStimulationLaunchRequest,
} from '@cnstra/persist-dto';
import {
    CNSStimulationsListRequestSchema,
    CNSStimulationsFacetsRequestSchema,
    CNSStimulationDetailRequestSchema,
    CNSStimulationsSnapshotRequestSchema,
} from './stimulations-query';
import { CNSScheduledStimulationsListRequestSchema } from './scheduled-stimulations-query';

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

// ─── Resumable-run actions (panel → server); canonical types in @cnstra/persist-dto ──
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

const CNSStimulationCommandShapeSchema = z.discriminatedUnion('name', [
    z.object({ name: z.literal('cancel') }),
    z.object({ name: z.literal('runNow') }),
    z.object({ name: z.literal('prioritize'), priority: z.number().int() }),
]);

export const CNSStimulationCommandDTOSchema: z.ZodType<TCNSStimulationCommand> = CNSStimulationCommandShapeSchema;

export const CNSStimulationCommandMessageDTOSchema = z.object({
    type: z.literal('stimulation.command'),
    requestId: z.string(),
    stimulationId: z.string(),
    command: CNSStimulationCommandDTOSchema,
});

export const CNSStimulationLaunchMessageDTOSchema = z.object({
    type: z.literal('stimulation.launch'),
    requestId: z.string(),
    entry: z.object({ collateralName: z.string().min(1), payload: z.unknown() }),
});

// drift guards — these validators must match the canonical persist-dto messages
type _RetryOk = Extends<TCNSStimulationRetryRequest, z.infer<typeof CNSStimulationRetryMessageDTOSchema>>;
type _CloneOk = Extends<TCNSStimulationCloneRequest, z.infer<typeof CNSStimulationCloneMessageDTOSchema>>;
type _CommandOk = Extends<TCNSStimulationCommandRequest, z.infer<typeof CNSStimulationCommandMessageDTOSchema>>;
type _CommandShapeOk = Extends<TCNSStimulationCommand, z.infer<typeof CNSStimulationCommandShapeSchema>>;
type _CommandShapeBack = Extends<z.infer<typeof CNSStimulationCommandShapeSchema>, TCNSStimulationCommand>;
type _LaunchOk = Extends<TCNSStimulationLaunchRequest, z.infer<typeof CNSStimulationLaunchMessageDTOSchema>>;

export const CNSClientMessageDTOSchema = z.discriminatedUnion('type', [
    CNSClientConnectMessageDTOSchema,
    CNSAppsQueryDTOSchema,
    CNSTopologyQueryDTOSchema,
    CNSStimulationsListRequestSchema,
    CNSStimulationsFacetsRequestSchema,
    CNSStimulationDetailRequestSchema,
    CNSStimulationsSnapshotRequestSchema,
    CNSScheduledStimulationsListRequestSchema,
    CNSStimulationRetryMessageDTOSchema,
    CNSStimulationCloneMessageDTOSchema,
    CNSStimulationCommandMessageDTOSchema,
    CNSStimulationLaunchMessageDTOSchema,
]);

export type TCNSClientMessageDTO = z.infer<typeof CNSClientMessageDTOSchema>;
