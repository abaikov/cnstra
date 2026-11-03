import { CNS } from '../CNS';
import { CNSCollateral } from '../CNSCollateral';
import type { ICNSCollateral } from '@cnstra/types';
import { TCNSAxon } from '@cnstra/types';
import { TCNSOptions } from '@cnstra/types';
import { TCNSDendrite } from '@cnstra/types';
import { TCNSHandlerContext } from '@cnstra/types';
import { TCNSNeuronResponseReturn } from '@cnstra/types';
import { TCNSNeuron } from '@cnstra/types';
import { TCNSModality } from '@cnstra/types';
import { TCNSAfferentPath } from '@cnstra/types';
import { TCNSStimulationOptions } from '@cnstra/types';
import type { TCNSModalitySelection } from '../types/TCNSModalitySelection';
import { cnsResolveModalityHandler } from '../utils/cnsResolveModalityHandler';
import { cnsComposeModalityResponse } from '../utils/cnsComposeModalityResponse';

let nextNeuronIndex = 0;
let nextAfferentPathIndex = 0;
let nextModalityIndex = 0;

export const cnsCollateral = <TPayload = undefined>() =>
    new CNSCollateral<TPayload>();

// Helper type to extract payload union from an array of collaterals
// Uses distributive conditional type to properly extract union, not intersection
// Works with both arrays and tuples
type CollateralPayloadUnion<
    TCollaterals extends readonly ICNSCollateral<unknown>[]
> = {
    [K in keyof TCollaterals]: TCollaterals[K] extends ICNSCollateral<infer P>
        ? P
        : never;
}[number];

type InterNeuronAPI<
    TAxonType extends TCNSAxon = TCNSAxon,
    TGlobal = unknown
> = {
    readonly index: number;
    axon: TAxonType;
    concurrency?: number;
    maxDuration?: number;
    dendrites: TCNSDendrite<
        ICNSCollateral<unknown>,
        TAxonType,
        TGlobal
    >[];
    setConcurrency: (
        n: number | undefined
    ) => InterNeuronAPI<TAxonType, TGlobal>;
    setMaxDuration: (
        ms: number | undefined
    ) => InterNeuronAPI<TAxonType, TGlobal>;
    bind: <TFollowAxon extends Record<string, ICNSCollateral<unknown>>>(
        axon: TFollowAxon,
        dendrites: {
            [K in keyof TFollowAxon]:
                | TCNSDendrite<TFollowAxon[K], TAxonType, TGlobal>
                | TCNSDendrite<
                      TFollowAxon[K],
                      TAxonType,
                      TGlobal
                  >['response'];
        }
    ) => InterNeuronAPI<TAxonType, TGlobal>;
    dendrite: {
        <TSenderCollateral extends ICNSCollateral<unknown>>(s: {
            collateral: TSenderCollateral;
            response: (
                payload: TSenderCollateral extends ICNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TGlobal>
            ) => TCNSNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TAxonType, TGlobal>;
        <
            TCollaterals extends readonly [
                ICNSCollateral<unknown>,
                ...ICNSCollateral<unknown>[]
            ]
        >(s: {
            collateral: TCollaterals;
            response: (
                payload: CollateralPayloadUnion<TCollaterals>,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TGlobal>
            ) => TCNSNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TAxonType, TGlobal>;
        <TPayloadUnion>(s: {
            collateral: ICNSCollateral<unknown>[];
            response: (
                payload: TPayloadUnion,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TGlobal>
            ) => TCNSNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TAxonType, TGlobal>;
        (
            s: TCNSDendrite<
                ICNSCollateral<unknown>,
                TAxonType,
                TGlobal
            >
        ): InterNeuronAPI<TAxonType, TGlobal>;
    };
    modalityDendrite: {
        <TSenderCollateral extends ICNSCollateral<unknown>, TResult>(s: {
            collateral: TSenderCollateral;
            modality: TCNSModality;
            afferentPaths?: Map<
                TCNSAfferentPath,
                (
                    payload: TSenderCollateral extends ICNSCollateral<infer P>
                        ? P
                        : never,
                    axon: TAxonType,
                    ctx: TCNSHandlerContext<TGlobal>
                ) => TResult | Promise<TResult>
            >;
            default?: (
                payload: TSenderCollateral extends ICNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TGlobal>
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TGlobal>
            ) => TCNSNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TAxonType, TGlobal>;
        <TSenderCollateral extends ICNSCollateral<unknown>, TResult>(s: {
            collateral: TSenderCollateral;
            modalities: Array<{
                modality: TCNSModality;
                afferentPaths?: Map<
                    TCNSAfferentPath,
                    (
                        payload: TSenderCollateral extends ICNSCollateral<
                            infer P
                        >
                            ? P
                            : never,
                        axon: TAxonType,
                        ctx: TCNSHandlerContext<TGlobal>
                    ) => TResult | Promise<TResult>
                >;
                default?: (
                    payload: TSenderCollateral extends ICNSCollateral<infer P>
                        ? P
                        : never,
                    axon: TAxonType,
                    ctx: TCNSHandlerContext<TGlobal>
                ) => TResult | Promise<TResult>;
            }>;
            default?: (
                payload: TSenderCollateral extends ICNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TGlobal>
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TGlobal>
            ) => TCNSNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TAxonType, TGlobal>;
    };
};

// Helper type to extract result type from output function
type ExtractResultFromOutput<T> = T extends (
    result: infer R,
    ...args: any[]
) => any
    ? R
    : never;

// Concrete builder
export const cnsNeuron = <
    TProvidedAxon extends Record<string, ICNSCollateral<unknown>>,
    TGlobal = unknown
>(
    axon: TProvidedAxon
): InterNeuronAPI<TCNSAxon<TProvidedAxon>, TGlobal> => {
    const dendrites: TCNSDendrite<
        ICNSCollateral<unknown>,
        TCNSAxon<TProvidedAxon>,
        TGlobal
    >[] = [];

    const api: InterNeuronAPI<TCNSAxon<TProvidedAxon>, TGlobal> = {
        setConcurrency: (n: number | undefined) => {
            api.concurrency = n;
            return api;
        },
        setMaxDuration: (ms: number | undefined) => {
            api.maxDuration = ms;
            return api;
        },
        bind: ((axon, newDendrites) => {
            for (const key in newDendrites) {
                const value = newDendrites[key] as any;
                const dendrite =
                    typeof value === 'function'
                        ? {
                              collateral: (axon as any)[key],
                              response: value,
                          }
                        : value;
                dendrites.push(
                    dendrite as TCNSDendrite<
                        ICNSCollateral<unknown>,
                        TCNSAxon<TProvidedAxon>,
                        TGlobal
                    >
                );
            }
            return api;
        }) as InterNeuronAPI<
            TCNSAxon<TProvidedAxon>,
            TGlobal
        >['bind'],
        index: nextNeuronIndex++,
        axon: axon as unknown as TCNSAxon<TProvidedAxon>,
        concurrency: undefined,
        maxDuration: undefined,
        dendrites,
        dendrite(s: any) {
            // Check if it's a shorthand format with multiple collaterals
            if (
                'collateral' in s &&
                'response' in s &&
                Array.isArray(s.collateral)
            ) {
                // Shorthand format with multiple collaterals - create one dendrite per collateral
                for (const collateral of s.collateral) {
                    dendrites.push({
                        collateral,
                        response: s.response,
                    } as TCNSDendrite<ICNSCollateral<unknown>, TCNSAxon<TProvidedAxon>, TGlobal>);
                }
            } else {
                // Either full dendrite object or shorthand with single collateral
                // Both have the same structure, so we handle them the same way
                dendrites.push(
                    s as TCNSDendrite<
                        ICNSCollateral<unknown>,
                        TCNSAxon<TProvidedAxon>,
                        TGlobal
                    >
                );
            }
            return api; // keep full API for chaining
        },
        modalityDendrite(s: any) {
            const {
                collateral,
                modality: singleModality,
                modalities: multipleModalities,
                afferentPaths: singleAfferentPaths,
                default: defaultHandler,
                output,
            } = s;

            // Normalize to array format for unified processing
            const modalityConfigs: Array<{
                modality: TCNSModality;
                afferentPaths?: Map<TCNSAfferentPath, any>;
                default?: any;
            }> = multipleModalities
                ? multipleModalities
                : singleModality
                ? [
                      {
                          modality: singleModality,
                          afferentPaths: singleAfferentPaths,
                          default: defaultHandler,
                      },
                  ]
                : [];

            const response = (payload: any, axon: any, ctx: any) => {
                const stimulation = ctx.stimulation as
                    | {
                          options?: TCNSStimulationOptions<any>;
                      }
                    | undefined;

                const stimOptions = stimulation?.options;
                const handler = cnsResolveModalityHandler(
                    modalitySelection,
                    stimOptions?.modality,
                    stimOptions?.afferentPath
                );
                if (handler === undefined) {
                    throw new Error(
                        `modalityDendrite: No handler found for afferent path in modality and no default handler provided`
                    );
                }
                return cnsComposeModalityResponse(handler, output)(payload, axon, ctx);
            };

            const modalitySelection: TCNSModalitySelection = {
                modalityConfigs,
                defaultHandler,
                output,
            };

            dendrites.push({
                collateral,
                response,
                modalitySelection,
            } as TCNSDendrite<ICNSCollateral<unknown>, TCNSAxon<TProvidedAxon>, TGlobal>);

            return api;
        },
    };

    return api;
};

/**
 * A composable neuron factory. Each `.withX<T>()` returns a *new typed view* of
 * the same underlying builder (the layers are type-only — zero runtime cost, no
 * per-activation overhead), so you bake your ctx additions once and reuse them
 * everywhere. Layers compose in any order and never touch the handler signature.
 *
 * `TExt` is the accumulated ctx extension: each layer *intersects* its own fields
 * into it, so a base factory (`TExt = unknown`) hands neurons the plain ctx bag —
 * nothing is forced onto anyone who didn't ask for it. `withGlobal<T>()` is the
 * built-in layer; make `T` an object to carry as much as you want (store, clock,
 * logger, …) through the single runtime channel wired at `new CNS`/`CNSFactory.create`.
 *
 * @example
 * // src/neurons/factory.ts — ctx shape baked once
 * type TGlobal = { store: Store; now(): number; newId(): string };
 * export const { neuron } = cnsNeuronFactory().withGlobal<TGlobal>();
 *
 * // any neuron file — plain value, reaches deps via ctx.global
 * export const taskNeuron = neuron({ taskCreated }).bind({ createTask }, {
 *   createTask: ({ title }, axon, { global }) =>
 *     axon.taskCreated.createSignal({ id: global.newId(), title, at: global.now() }),
 * });
 */
export type TCNSNeuronFactory<TExt = unknown> = {
    /** Add `{ global: T }` to ctx; the value is injected once at `new CNS`/`CNSFactory.create`. */
    withGlobal: <T>() => TCNSNeuronFactory<TExt & { global: T }>;
    neuron: <TProvidedAxon extends Record<string, ICNSCollateral<unknown>>>(
        axon: TProvidedAxon
    ) => InterNeuronAPI<TCNSAxon<TProvidedAxon>, TExt>;
};

export const cnsNeuronFactory = <TExt = unknown>(): TCNSNeuronFactory<TExt> => {
    // Single stateless object reused across every layer call: `.withX()` only
    // re-types it, so there is nothing to allocate or carry at runtime.
    const factory: TCNSNeuronFactory<TExt> = {
        withGlobal: () => factory as unknown as TCNSNeuronFactory<any>,
        neuron: axon => cnsNeuron(axon) as any,
    };
    return factory;
};

/** Sugar: `cnsNeuronFactory().withGlobal<T>()`. */
export const withCNSGlobal = <T>(): TCNSNeuronFactory<{ global: T }> =>
    cnsNeuronFactory<{ global: T }>();

export const cnsAfferentPath = (
    parentAfferentPath?: TCNSAfferentPath
): TCNSAfferentPath => {
    return {
        index: nextAfferentPathIndex++,
        ...(parentAfferentPath !== undefined && {
            parentAfferentPath,
        }),
    };
};

export const cnsModality = (
    afferentPaths: Record<string | number, TCNSAfferentPath>
): TCNSModality => {
    return {
        index: nextModalityIndex++,
        afferentPaths,
    };
};
