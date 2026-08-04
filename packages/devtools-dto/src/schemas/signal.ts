import { z } from 'zod';
import type { TCNSSignalJSON } from '@cnstra/persist-dto';

/**
 * Wire validator for the canonical signal leaf. Its inferred type IS
 * `TCNSSignalJSON` (persist-dto) — the ONE signal shape shared by the durable
 * model, the explorer wire buckets, and the panel. No parallel `…ViewDTO` signal
 * type.
 */
export const CNSSignalJSONSchema: z.ZodType<TCNSSignalJSON> = z.object({
    collateralName: z.string(),
    payload: z.unknown(),
});

/** Re-exported canonical signal leaf (persist-dto) — one shape across all layers. */
export type { TCNSSignalJSON } from '@cnstra/persist-dto';
