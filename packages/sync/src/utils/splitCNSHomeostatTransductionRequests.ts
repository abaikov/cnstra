import type { ICNSHomeostatTransductionCodec } from '../interfaces/ICNSHomeostatTransductionCodec';
import type { TCNSHomeostatTransductionRequest } from '../types/TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionRow } from '../types/TCNSHomeostatTransductionRow';

export function splitCNSHomeostatTransductionRequests(
    homeostatTransductionCodec: ICNSHomeostatTransductionCodec,
    homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]
): { refusedRows: TCNSHomeostatTransductionRow[]; encodableRequests: TCNSHomeostatTransductionRequest[] } {
    const refusedRows: TCNSHomeostatTransductionRow[] = [];
    const encodedAloneRequests = homeostatTransductionRequests.filter(({ name, key }) => {
        try {
            homeostatTransductionCodec.encodeRequests([{ name, key }]);
            return true;
        } catch (error) {
            refusedRows.push({ name, key, error });
            return false;
        }
    });
    return { refusedRows, encodableRequests: homeostatTransductionCodec.dropCoveredRequests?.(encodedAloneRequests) ?? encodedAloneRequests };
}
