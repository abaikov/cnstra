export { CNS } from './CNS';
export { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
export { CNSCollateral } from './CNSCollateral';
export { CNSStimulationContextStore } from './CNSStimulationContextStore';
export { CNSStimulationGate } from './utils/CNSStimulationGate';

export type { ICNS } from './interfaces/ICNS';

export type { TCNSNeuron } from './types/TCNSNeuron';
export type { TCNSAxon } from './types/TCNSAxon';
export type { TCNSDendrite } from './types/TCNSDendrite';
export type { TCNSSignal } from './types/TCNSSignal';
export type { TCNSNeuronActivationTask } from './types/TCNSNeuronActivationTask';
export type { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
export type { TCNSModality } from './types/TCNSModality';
export type { TCNSAfferentPath } from './types/TCNSAfferentPath';
export type { TCNSNeuronActivationTaskFailure } from './types/TCNSNeuronActivationTaskFailure';
export type { TCNSNeuronPersistOptions, TCNSCollateralPersistOptions, TCNSStimulationPersistOptions } from './types/TCNSPersist';
export type { TCNSStimulationGateOptions, TCNSStimulationGateSignal } from './utils/CNSStimulationGate';

// Factory
export {
    collateral,
    neuron,
    withCtx,
    afferentPath,
    modality,
    createPersistRegistry,
} from './factory/index';
