export { CNS } from './CNS';
export { createCNS } from './createCNS';
export { CNSCollateral } from './CNSCollateral';
export { CNSStimulationGate } from './utils/CNSStimulationGate';

// Shared types/interfaces now live in @cnstra/types and are NOT re-exported here
// (intentional clean split — import them from '@cnstra/types' directly).
// Only types that still physically live in core are exported below.
export type { TCNSStimulationGateOptions } from './utils/CNSStimulationGate';

// Factory
export {
    cnsCollateral,
    cnsNeuron,
    cnsNeuronFactory,
    withCNSGlobal,
    cnsAfferentPath,
    cnsModality,
} from './factory/index';
export type { TCNSNeuronFactory } from './factory/index';
