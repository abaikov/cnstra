import { cnsCollateral, cnsNeuron } from '@cnstra/core';
import type { TCNSAxon, TCNSNeuron, TCNSStimulationOptions, TCNSStimulationResponse } from '@cnstra/types';
import type { TCNSHomeostatRefractoryPolicy } from './types/TCNSHomeostatRefractoryPolicy';
import type { TCNSHomeostatReceptorOptions } from './types/TCNSHomeostatReceptorOptions';

export class CNSHomeostatReceptor<TKey extends readonly unknown[], TData> {
    public readonly name: string;

    public readonly axon = {
        homeostatFired: cnsCollateral<{ key: TKey; firingNumber: number }>(),
        homeostasisRestored: cnsCollateral<{ key: TKey; firingNumber: number; data: TData }>(),
        homeostasisFailed: cnsCollateral<{ key: TKey; firingNumber: number; error: unknown }>(),
        homeostasisCancelled: cnsCollateral<{ key: TKey; firingNumber: number }>(),
        homeostasisDisturbed: cnsCollateral<{ key: TKey; firingNumber: number }>(),
    };

    public readonly neuron: TCNSNeuron<TCNSAxon<CNSHomeostatReceptor<TKey, TData>['axon']>> = cnsNeuron(this.axon);

    public readonly transduce: ((key: TKey, abortSignal: AbortSignal) => Promise<TData>) | undefined;

    public readonly staleTimeMs: number | undefined;

    public readonly homeostatRefractoryPolicy: TCNSHomeostatRefractoryPolicy | undefined;

    public readonly stimulationOptions: TCNSStimulationOptions<TCNSStimulationResponse> | undefined;

    public constructor(options: TCNSHomeostatReceptorOptions<TKey, TData>) {
        this.name = options.name;
        this.transduce = options.transduce;
        this.staleTimeMs = options.staleTimeMs;
        this.homeostatRefractoryPolicy = options.homeostatRefractoryPolicy;
        this.stimulationOptions = options.stimulationOptions;
    }
}
