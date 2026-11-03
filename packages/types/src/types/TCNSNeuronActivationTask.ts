import { TCNSContextStore } from './TCNSContextStore';
import { ICNSCollateral } from '../interfaces/ICNSCollateral';
import { TCNSSignal } from './TCNSSignal';

export type TCNSNeuronActivationTask<
    TNeuron extends object = object,
    TCollateral extends ICNSCollateral<unknown> = ICNSCollateral<unknown>
> = {
    neuron: TNeuron;
    dendriteCollateral: TCollateral;
    input?: TCNSSignal<TCollateral>;
    /**
     * Data attached to THIS activation, in namespaced compartments — the
     * per-activation sibling of `stimulationContext`.
     *
     * A response listener can write here before the activation runs (the engine
     * builds these tasks first and hands them to the listener on the response),
     * and the dendrite reads them back as `ctx.activationContext`.
     *
     * Compartment keys are strings, by convention the writer's package name, so
     * an integration and your own code cannot overwrite each other. What is
     * portable travels with the serialized frontier; a live handle does not —
     * see `portable()` in `@cnstra/persist`.
     */
    activationContext?: TCNSContextStore;
};

