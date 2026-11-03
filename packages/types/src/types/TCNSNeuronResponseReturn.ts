import { TCNSSignal } from './TCNSSignal';
import { TCNSAxon } from './TCNSAxon';

/**
 * Allowed return types from a neuron dendrite `response` function.
 *
 * Signals route by collateral object identity (not by name).
 */
export type TCNSNeuronResponseReturn<TAxon extends TCNSAxon> =
    | TCNSSignal<TAxon[keyof TAxon]>
    | TCNSSignal<TAxon[keyof TAxon]>[]
    | void
    | Promise<
          | TCNSSignal<TAxon[keyof TAxon]>
          | TCNSSignal<TAxon[keyof TAxon]>[]
          | void
      >;
