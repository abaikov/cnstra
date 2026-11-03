import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import type { TCNSHomeostatCorrectionState } from './TCNSHomeostatCorrectionState';
import type { TCNSHomeostatOutcome } from './TCNSHomeostatOutcome';

export type TCNSHomeostatReceptorCorrectionOptions = {
    homeostatReceptors: readonly CNSHomeostatReceptor<never, unknown>[];
    reduceHomeostatCorrectionState?: (
        homeostatCorrectionState: TCNSHomeostatCorrectionState<readonly unknown[]> | undefined,
        homeostatOutcome: TCNSHomeostatOutcome<readonly unknown[]>
    ) => TCNSHomeostatCorrectionState<readonly unknown[]> | undefined;
};
