/**
 * The only seam to the code under test. Imports each package's `src`, not its
 * `dist`: a stale build would have the benchmark report "no regression" about
 * code that is not running. Point it at the bundles here if that is ever wanted.
 */

export { CNS, collateral, neuron } from '../../core/src/index';

export {
    CNSPersistOptionsRegistry,
    CNSProgressSerializer,
    CNSStimulationPersistor,
    CNSInMemoryStimulationRepository,
    loadCNSRosterEntries,
    computeCNSRosterFacets,
} from '../../persist/src/index';

export { attachCNSOtelTracing } from '../../persist-otel/src/index';

export type {
    ICNSCollateral,
    ICNSStimulation,
    TCNSNeuron,
    TCNSSignal,
    TCNSStimulationResponse,
} from '../../types/src/index';

export type {
    TCNSProgress,
    TCNSSignalJSON,
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '../../persist-dto/src/index';
