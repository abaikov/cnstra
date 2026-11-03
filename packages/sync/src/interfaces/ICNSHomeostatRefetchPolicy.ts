import type { TCNSHomeostatCorrectionState } from '../types/TCNSHomeostatCorrectionState';

export interface ICNSHomeostatRefetchPolicy {
    refetchAtMs(homeostatCorrectionState: TCNSHomeostatCorrectionState<unknown>): number;
}
