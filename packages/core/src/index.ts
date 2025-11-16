export { CNS } from './CNS';
export { CNSCollateral } from './CNSCollateral';
export { CNSStimulationContextStore } from './CNSStimulationContextStore';

export type { ICNS } from './interfaces/ICNS';

export type { TCNSNeuron } from './types/TCNSNeuron';
export type { TCNSAxon } from './types/TCNSAxon';
export type { TCNSDendrite } from './types/TCNSDendrite';
export type { TCNSSignal } from './types/TCNSSignal';
export type { TCNSNeuronActivationTask } from './types/TCNSNeuronActivationTask';
export type { TCNSStimulationOptions } from './types/TCNSStimulationOptions';
export type { TCNSNeuronActivationTaskFailure } from './types/TCNSNeuronActivationTaskFailure';

// Factory
export { collateral, neuron, withCtx } from './factory/index';
