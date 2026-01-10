import { TCNSAxon } from './TCNSAxon';
import { TCNSDendrite } from './TCNSDendrite';
import { CNSCollateral } from '../CNSCollateral';

export type TCNSNeuron<
    TContextValue,
    TAxonType extends TCNSAxon = TCNSAxon
> = {
    axon: TAxonType;
    /** Optional per-neuron concurrency limit. If undefined or <= 0, no limit is applied. */
    concurrency?: number;
    /** Optional per-neuron max processing duration in milliseconds. */
    maxDuration?: number;
    dendrites: TCNSDendrite<
        TContextValue,
        CNSCollateral<unknown>,
        TAxonType
    >[];
};
