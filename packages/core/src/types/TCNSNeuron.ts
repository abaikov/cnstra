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
    // TExt is `any` on purpose: a stored neuron erases which ctx extensions its
    // dendrites were authored with (withGlobal, …), so neurons carrying `ctx.global`
    // stay assignable to the runtime graph. The extension typing lives on the
    // authoring side (neuronFactory), where it belongs; the engine only runs them.
    dendrites: TCNSDendrite<
        TContextValue,
        CNSCollateral<unknown>,
        TAxonType,
        any
    >[];
};
