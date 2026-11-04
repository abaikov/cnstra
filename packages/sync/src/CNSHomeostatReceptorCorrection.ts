import { neuron } from '@cnstra/core';
import type { TCNSAxon, TCNSContextStore, TCNSNeuron } from '@cnstra/types';
import type { CNSHomeostatReceptor } from './CNSHomeostatReceptor';
import { ECNSHomeostatCorrectionStatus } from './types/ECNSHomeostatCorrectionStatus';
import { CNSHomeostatFiringContext } from './CNSHomeostatFiringContext';
import type { TCNSHomeostatReceptorCorrectionOptions } from './types/TCNSHomeostatReceptorCorrectionOptions';
import { CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY } from './utils/CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY';
import { reduceCNSHomeostatCorrectionState } from './utils/reduceCNSHomeostatCorrectionState';
import type { TCNSHomeostatOutcomeStatus } from './types/TCNSHomeostatOutcomeStatus';

export class CNSHomeostatReceptorCorrection {
    public readonly neuron: TCNSNeuron<TCNSAxon<{}>>;

    private readonly reduceHomeostatCorrectionState: NonNullable<TCNSHomeostatReceptorCorrectionOptions['reduceHomeostatCorrectionState']>;

    public constructor(options: TCNSHomeostatReceptorCorrectionOptions) {
        this.reduceHomeostatCorrectionState = options.reduceHomeostatCorrectionState ?? reduceCNSHomeostatCorrectionState;
        let correctionNeuron = neuron({});
        for (const homeostatReceptor of options.homeostatReceptors) {
            correctionNeuron = correctionNeuron
                .dendrite({
                    collateral: homeostatReceptor.axon.homeostasisRestored,
                    response: (payload, _axon, ctx) => this.correct(
                        homeostatReceptor, payload.key, payload.firingNumber, ECNSHomeostatCorrectionStatus.Restored, undefined, ctx.stimulationContext
                    ),
                })
                .dendrite({
                    collateral: homeostatReceptor.axon.homeostasisFailed,
                    response: (payload, _axon, ctx) => this.correct(
                        homeostatReceptor, payload.key, payload.firingNumber, ECNSHomeostatCorrectionStatus.Failed, payload.error, ctx.stimulationContext
                    ),
                })
                .dendrite({
                    collateral: homeostatReceptor.axon.homeostasisDisturbed,
                    response: (payload, _axon, ctx) => this.disturb(homeostatReceptor, payload.key, payload.firingNumber, ctx.stimulationContext),
                });
        }
        this.neuron = correctionNeuron;
    }

    private disturb(
        homeostatReceptor: CNSHomeostatReceptor<never, unknown>,
        key: readonly unknown[],
        firingNumber: number,
        stimulationContext: TCNSContextStore | undefined
    ): undefined {
        const homeostatFiringContext = stimulationContext?.[CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY];
        if (!(homeostatFiringContext instanceof CNSHomeostatFiringContext)) return undefined;
        const homeostatCorrectionRepository = homeostatFiringContext.homeostatCorrectionRepository;
        const keyHash = homeostatFiringContext.keyHash;
        const previous = homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash);
        if (previous !== undefined && previous.firingNumber > firingNumber) return undefined;
        const invalidationNumber = Math.max(previous?.invalidationNumber ?? 0, homeostatFiringContext.invalidationNumber);
        homeostatCorrectionRepository.writeHomeostatCorrectionState(keyHash, previous === undefined ? {
            receptorName: homeostatReceptor.name,
            key,
            status: ECNSHomeostatCorrectionStatus.Stale,
            firingNumber,
            attempt: 0,
            startedAtMs: homeostatFiringContext.startedAtMs,
            restoredAtMs: undefined,
            failedAtMs: undefined,
            error: undefined,
            invalidationNumber,
        } : { ...previous, status: ECNSHomeostatCorrectionStatus.Stale, firingNumber, invalidationNumber });
        return undefined;
    }

    private correct(
        homeostatReceptor: CNSHomeostatReceptor<never, unknown>,
        key: readonly unknown[],
        firingNumber: number,
        status: TCNSHomeostatOutcomeStatus,
        error: unknown,
        stimulationContext: TCNSContextStore | undefined
    ): undefined {
        const homeostatFiringContext = stimulationContext?.[CNS_HOMEOSTAT_REGULATOR_STIMULATION_CONTEXT_KEY];
        if (!(homeostatFiringContext instanceof CNSHomeostatFiringContext)) return undefined;
        const homeostatCorrectionRepository = homeostatFiringContext.homeostatCorrectionRepository;
        const keyHash = homeostatFiringContext.keyHash;
        const homeostatCorrectionState = this.reduceHomeostatCorrectionState(homeostatCorrectionRepository.peekHomeostatCorrectionState(keyHash), {
            receptorName: homeostatReceptor.name,
            key,
            firingNumber,
            status,
            error,
            startedAtMs: homeostatFiringContext.startedAtMs,
            nowMs: homeostatFiringContext.getNowMs(),
            invalidationNumber: homeostatFiringContext.invalidationNumber,
        });
        if (homeostatCorrectionState !== undefined) homeostatCorrectionRepository.writeHomeostatCorrectionState(keyHash, homeostatCorrectionState);
        return undefined;
    }
}
