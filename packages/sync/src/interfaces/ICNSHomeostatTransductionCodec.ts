import type { TCNSHomeostatTransductionRequest } from '../types/TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionRow } from '../types/TCNSHomeostatTransductionRow';

export interface ICNSHomeostatTransductionCodec {
    readonly mediaType: string;
    dropCoveredRequests?(homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): TCNSHomeostatTransductionRequest[];
    encodeRequests(homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): string;
    decodeRequests(encodedRequests: string): TCNSHomeostatTransductionRequest[];
    encodeRows(homeostatTransductionRows: readonly TCNSHomeostatTransductionRow[], encodedRequests: string): string;
    decodeRows(encodedRows: string, encodedRequests: string): TCNSHomeostatTransductionRow[];
}
