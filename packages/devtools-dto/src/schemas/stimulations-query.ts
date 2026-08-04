import { z } from 'zod';
import { CNSSignalJSONSchema } from './stimulation-view';

/**
 * The DevTools "explorer" protocol — normalized BUCKETS, not a join-tree. Each
 * response carries a flat list per collection (like table rows), which the panel
 * upserts straight into its OIMDB collections; relations are joined on the client
 * by id via indexes. Two round-trips:
 *   - `cns.stimulations.list`  → the roster page (`stimulations` bucket) + `page`.
 *   - `cns.stimulations.facets`→ aggregate counts (for the facet rail).
 *   - `cns.stimulation.detail` → one run's `attempts` + `tasks` buckets (waterfall).
 * The nested `TCNSStimulationViewDTO` and its server-side join / client-side flatten
 * are retired by this path.
 */

// ─── Row DTO: the roster's flat list row ──────────────────────────────────────
// = the durable state WITHOUT `progress` (resume state the list never needs), PLUS
// the storage-envelope summaries the canonical `TCNSStimulationState` deliberately
// excludes (see its doc). Server-computed from the run's attempts at query time —
// one query-result projection, not a parallel entity family.
export const CNSStimulationRowDTOSchema = z.object({
    stimulationId: z.string(),
    scopeName: z.string().optional(),
    entry: CNSSignalJSONSchema,
    status: z.string(),
    startedAt: z.number(),
    completedAt: z.number().nullable(),
    hopCount: z.number(),
    hasError: z.boolean(),
});
export type TCNSStimulationRowDTO = z.infer<typeof CNSStimulationRowDTOSchema>;

// Wire VALIDATORS for the detail buckets. The canonical TYPES are the persist-dto
// entities (re-exported below) — these schemas only validate the wire shape; status
// is validated loosely as a string (the enum lives in the type).
export const CNSStimulationAttemptDTOSchema = z.object({
    stimulationAttemptId: z.string(),
    stimulationId: z.string(),
    attemptNumber: z.number(),
    status: z.string(),
    startedAt: z.number(),
    completedAt: z.number().nullable(),
    hopCount: z.number(),
    hasError: z.boolean(),
    replayOf: z.string().nullable(),
    entry: z.array(CNSSignalJSONSchema),
});
export const CNSStimulationTaskDTOSchema = z.object({
    stimulationAttemptId: z.string(),
    index: z.number(),
    neuronName: z.string(),
    dendriteCollateralName: z.string(),
    inputIndex: z.number(),
    output: CNSSignalJSONSchema.nullable(),
    status: z.string(),
    error: z.string().nullable(),
    startedAt: z.number(),
    duration: z.number().nullable(),
});

// ─── Filter + cursor (shared by list + facets) ────────────────────────────────
export const CNSStimulationFilterSchema = z
    .object({
        status: z.string(),
        entryCollateralName: z.string(),
        /** Runs that activated this neuron (any task with this neuronName). */
        neuronName: z.string(),
        /** Substring match on stimulationId (and, server-permitting, entry payload). */
        text: z.string(),
        since: z.number(),
        until: z.number(),
    })
    .partial();
export type TCNSStimulationFilter = z.infer<typeof CNSStimulationFilterSchema>;

// ─── list request/result ──────────────────────────────────────────────────────
export const CNSStimulationsListRequestSchema = z.object({
    type: z.literal('cns.stimulations.list'),
    requestId: z.string(),
    scopeName: z.string().optional(),
    filter: CNSStimulationFilterSchema.optional(),
    /** Opaque keyset cursor from a prior page's `nextCursor`. */
    cursor: z.string().optional(),
    limit: z.number().optional(),
});
export type TCNSStimulationsListRequest = z.infer<
    typeof CNSStimulationsListRequestSchema
>;

export const CNSStimulationsListResultSchema = z.object({
    type: z.literal('cns.stimulations.list.result'),
    requestId: z.string(),
    stimulations: z.array(CNSStimulationRowDTOSchema),
    nextCursor: z.string().nullable().optional(),
    total: z.number().optional(),
});
export type TCNSStimulationsListResult = z.infer<
    typeof CNSStimulationsListResultSchema
>;

// ─── facets request/result ────────────────────────────────────────────────────
export const CNSStimulationsFacetsRequestSchema = z.object({
    type: z.literal('cns.stimulations.facets'),
    requestId: z.string(),
    scopeName: z.string().optional(),
    filter: CNSStimulationFilterSchema.optional(),
    /**
     * Optional dot-path into each run's entry payload (e.g. `pages`,
     * `doc.pageCount`). When set, every `byTime` bucket also carries `metric` =
     * the SUM of that numeric field across the bucket's runs — the "how many
     * pages were processed" board, aggregated at query time.
     */
    metricPath: z.string().optional(),
});
export type TCNSStimulationsFacetsRequest = z.infer<
    typeof CNSStimulationsFacetsRequestSchema
>;

// One time-bucket of the throughput histogram: run counts by lifecycle state,
// plus the optional payload metric sum (present only when `metricPath` is set).
export const CNSStimulationTimeBucketSchema = z.object({
    tsBucket: z.number(),
    completed: z.number(),
    failed: z.number(),
    running: z.number(),
    metric: z.number().optional(),
});
export type TCNSStimulationTimeBucket = z.infer<
    typeof CNSStimulationTimeBucketSchema
>;

export const CNSStimulationFacetsDTOSchema = z.object({
    byEntryCollateral: z.array(
        z.object({ name: z.string(), count: z.number() })
    ),
    byStatus: z.array(z.object({ status: z.string(), count: z.number() })),
    /** Activation count per neuron (the neurons lens). */
    byNeuron: z.array(z.object({ name: z.string(), count: z.number() })),
    /** Throughput histogram over the filtered set (the Chart view). */
    byTime: z.array(CNSStimulationTimeBucketSchema),
});
export type TCNSStimulationFacetsDTO = z.infer<
    typeof CNSStimulationFacetsDTOSchema
>;

export const CNSStimulationsFacetsResultSchema = z.object({
    type: z.literal('cns.stimulations.facets.result'),
    requestId: z.string(),
    facets: CNSStimulationFacetsDTOSchema,
});
export type TCNSStimulationsFacetsResult = z.infer<
    typeof CNSStimulationsFacetsResultSchema
>;

// ─── detail request/result (one run → attempts + tasks buckets) ───────────────
export const CNSStimulationDetailRequestSchema = z.object({
    type: z.literal('cns.stimulation.detail'),
    requestId: z.string(),
    stimulationId: z.string(),
});
export type TCNSStimulationDetailRequest = z.infer<
    typeof CNSStimulationDetailRequestSchema
>;

export const CNSStimulationDetailResultSchema = z.object({
    type: z.literal('cns.stimulation.detail.result'),
    requestId: z.string(),
    attempts: z.array(CNSStimulationAttemptDTOSchema),
    tasks: z.array(CNSStimulationTaskDTOSchema),
});
export type TCNSStimulationDetailResult = z.infer<
    typeof CNSStimulationDetailResultSchema
>;

/** Re-export the reused canonical entities so the panel imports buckets from one place. */
export type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';
