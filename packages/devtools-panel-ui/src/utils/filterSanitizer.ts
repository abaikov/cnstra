export type ExportFilters = {
    fromTimestamp?: number;
    toTimestamp?: number;
    offset?: number;
    limit?: number;
};

export function sanitizeFilters(input: Partial<ExportFilters>): ExportFilters {
    const out: ExportFilters = {};
    if (
        typeof input.fromTimestamp === 'number' &&
        isFinite(input.fromTimestamp)
    ) {
        out.fromTimestamp = Math.max(0, Math.floor(input.fromTimestamp));
    }
    if (typeof input.toTimestamp === 'number' && isFinite(input.toTimestamp)) {
        out.toTimestamp = Math.max(0, Math.floor(input.toTimestamp));
    }
    if (typeof input.offset === 'number' && isFinite(input.offset)) {
        out.offset = Math.max(0, Math.floor(input.offset));
    }
    if (typeof input.limit === 'number' && isFinite(input.limit)) {
        out.limit = Math.max(1, Math.floor(input.limit));
    }
    if (
        typeof out.fromTimestamp === 'number' &&
        typeof out.toTimestamp === 'number' &&
        out.fromTimestamp > out.toTimestamp
    ) {
        [out.fromTimestamp, out.toTimestamp] = [
            out.toTimestamp,
            out.fromTimestamp,
        ];
    }
    return out;
}
