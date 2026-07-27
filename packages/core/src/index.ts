export { CNS } from './CNS';
// CNSPersistOptionsRegistry + createPersistRegistry moved to @cnstra/persist;
// createCNS moved to @cnstra/factory (keeps core a pure, dependency-light engine).
export { CNSCollateral } from './CNSCollateral';
export { CNSStimulationContextStore } from './CNSStimulationContextStore';
export { CNSStimulationGate } from './utils/CNSStimulationGate';

// Shared types/interfaces now live in @cnstra/types and are NOT re-exported here
// (intentional clean split — import them from '@cnstra/types' directly).
// Only types that still physically live in core are exported below.
export type { TCNSStimulationGateOptions, TCNSStimulationGateSignal } from './utils/CNSStimulationGate';

// Factory
export {
    collateral,
    neuron,
    neuronFactory,
    withCtx,
    withGlobal,
    afferentPath,
    modality,
} from './factory/index';
export type { TNeuronFactory } from './factory/index';
