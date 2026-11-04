import { CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS } from './CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS';

export function computeCNSHomeostatRefetchSliceEndMs(refetchAtMs: number): number {
    return (Math.floor(refetchAtMs / CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS) + 1) * CNS_HOMEOSTAT_REFETCH_SLICE_LENGTH_MS;
}
