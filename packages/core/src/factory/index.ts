import { CNS } from '../CNS';
import { CNSCollateral } from '../CNSCollateral';
import type { ICNSCollateral } from '@cnstra/types';
import { TCNSAxon } from '@cnstra/types';
import { TCNSOptions } from '@cnstra/types';
import { TCNSDendrite } from '@cnstra/types';
import { TCNSHandlerContext } from '@cnstra/types';
import { TNCNeuronResponseReturn } from '@cnstra/types';
import { TCNSNeuron } from '@cnstra/types';
import { TCNSModality } from '@cnstra/types';
import { TCNSAfferentPath } from '@cnstra/types';
import { TCNSStimulationOptions } from '@cnstra/types';

export const collateral = <TPayload = undefined>() =>
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
    TContextValue,
    TAxonType extends TCNSAxon = TCNSAxon,
    TGlobal = unknown
> = {
    axon: TAxonType;
    concurrency?: number;
    maxDuration?: number;
    dendrites: TCNSDendrite<
        TContextValue,
        ICNSCollateral<unknown>,
        TAxonType,
        TGlobal
    >[];
    setConcurrency: (
        n: number | undefined
    ) => InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
    setMaxDuration: (
        ms: number | undefined
    ) => InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
    bind: <TFollowAxon extends Record<string, ICNSCollateral<unknown>>>(
        axon: TFollowAxon,
        dendrites: {
            [K in keyof TFollowAxon]:
                | TCNSDendrite<TContextValue, TFollowAxon[K], TAxonType, TGlobal>
                | TCNSDendrite<
                      TContextValue,
                      TFollowAxon[K],
                      TAxonType,
                      TGlobal
                  >['response'];
        }
    ) => InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
    dendrite: {
        <TSenderCollateral extends ICNSCollateral<unknown>>(s: {
            collateral: TSenderCollateral;
            response: (
                payload: TSenderCollateral extends ICNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TContextValue, TGlobal>
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
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
                ctx: TCNSHandlerContext<TContextValue, TGlobal>
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
        <TPayloadUnion>(s: {
            collateral: ICNSCollateral<unknown>[];
            response: (
                payload: TPayloadUnion,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TContextValue, TGlobal>
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
        (
            s: TCNSDendrite<
                TContextValue,
                ICNSCollateral<unknown>,
                TAxonType,
                TGlobal
            >
        ): InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
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
                    ctx: TCNSHandlerContext<TContextValue, TGlobal>
                ) => TResult | Promise<TResult>
            >;
            default?: (
                payload: TSenderCollateral extends ICNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TContextValue, TGlobal>
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TContextValue, TGlobal>
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
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
                        ctx: TCNSHandlerContext<TContextValue, TGlobal>
                    ) => TResult | Promise<TResult>
                >;
                default?: (
                    payload: TSenderCollateral extends ICNSCollateral<infer P>
                        ? P
                        : never,
                    axon: TAxonType,
                    ctx: TCNSHandlerContext<TContextValue, TGlobal>
                ) => TResult | Promise<TResult>;
            }>;
            default?: (
                payload: TSenderCollateral extends ICNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TContextValue, TGlobal>
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSHandlerContext<TContextValue, TGlobal>
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType, TGlobal>;
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
export const neuron = <
    TContextValue,
    TProvidedAxon extends Record<string, ICNSCollateral<unknown>>,
    TGlobal = unknown
>(
    axon: TProvidedAxon
): InterNeuronAPI<TContextValue, TCNSAxon<TProvidedAxon>, TGlobal> => {
    const dendrites: TCNSDendrite<
        TContextValue,
        ICNSCollateral<unknown>,
        TCNSAxon<TProvidedAxon>,
        TGlobal
    >[] = [];

    const api: InterNeuronAPI<TContextValue, TCNSAxon<TProvidedAxon>, TGlobal> = {
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
                        TContextValue,
                        ICNSCollateral<unknown>,
                        TCNSAxon<TProvidedAxon>,
                        TGlobal
                    >
                );
            }
            return api;
        }) as InterNeuronAPI<
            TContextValue,
            TCNSAxon<TProvidedAxon>,
            TGlobal
        >['bind'],
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
                    } as TCNSDendrite<TContextValue, ICNSCollateral<unknown>, TCNSAxon<TProvidedAxon>, TGlobal>);
                }
            } else {
                // Either full dendrite object or shorthand with single collateral
                // Both have the same structure, so we handle them the same way
                dendrites.push(
                    s as TCNSDendrite<
                        TContextValue,
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

                const runGlobalDefault = () => {
                    if (!defaultHandler) {
                        throw new Error(
                            `modalityDendrite: No handler found for modality and no default handler provided`
                        );
                    }

                    const res = defaultHandler(payload, axon, ctx);
                    if (res && typeof (res as any).then === 'function') {
                        return (res as Promise<any>).then((result: any) =>
                            output(result, axon, ctx)
                        );
                    }
                    return output(res, axon, ctx);
                };

                if (!stimOptions || !stimOptions.modality) {
                    return runGlobalDefault();
                }

                // Find matching modality config by object reference
                const matchingConfig = modalityConfigs.find(
                    config => config.modality === stimOptions.modality
                );

                if (!matchingConfig) {
                    return runGlobalDefault();
                }

                const stimAfferentPath = stimOptions.afferentPath;

                // Find handler by afferent path object reference
                const handler =
                    stimAfferentPath && matchingConfig.afferentPaths
                        ? matchingConfig.afferentPaths.get(stimAfferentPath)
                        : undefined;

                const effectiveHandler =
                    handler ?? matchingConfig.default ?? defaultHandler;

                if (!effectiveHandler) {
                    throw new Error(
                        `modalityDendrite: No handler found for afferent path in modality and no default handler provided`
                    );
                }

                const maybeResult = effectiveHandler(payload, axon, ctx);

                if (
                    maybeResult &&
                    typeof (maybeResult as any).then === 'function'
                ) {
                    return (maybeResult as Promise<any>).then((result: any) =>
                        output(result, axon, ctx)
                    );
                }

                try {
                    return output(maybeResult, axon, ctx);
                } catch (error) {
                    if (
                        error instanceof Error &&
                        error.message.includes(
                            'Cannot read properties of undefined'
                        )
                    ) {
                        const axonKeys =
                            axon && typeof axon === 'object'
                                ? Object.keys(axon)
                                : 'not an object';
                        throw new Error(
                            `modalityDendrite: axon.output is undefined. Axon type: ${typeof axon}, Axon keys: ${
                                Array.isArray(axonKeys)
                                    ? axonKeys.join(', ')
                                    : axonKeys
                            }. Make sure the neuron was created with the correct axon structure. Original error: ${
                                error.message
                            }`
                        );
                    }
                    throw error;
                }
            };

            dendrites.push({
                collateral,
                response,
            } as TCNSDendrite<TContextValue, ICNSCollateral<unknown>, TCNSAxon<TProvidedAxon>, TGlobal>);

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
 * logger, …) through the single runtime channel wired at `createCNS`/`new CNS`.
 *
 * @example
 * // src/neurons/factory.ts — ctx shape baked once
 * type TGlobal = { store: Store; now(): number; newId(): string };
 * export const { neuron } = neuronFactory().withGlobal<TGlobal>().withCtx<TCtx>();
 *
 * // any neuron file — plain value, reaches deps via ctx.global
 * export const taskNeuron = neuron({ taskCreated }).bind({ createTask }, {
 *   createTask: ({ title }, axon, { global }) =>
 *     axon.taskCreated.createSignal({ id: global.newId(), title, at: global.now() }),
 * });
 */
export type TNeuronFactory<TContextValue, TExt = unknown> = {
    /** Bake the per-stimulation, per-neuron context value type (`ctx.get()/set()`). */
    withCtx: <T>() => TNeuronFactory<T, TExt>;
    /** Add `{ global: T }` to ctx; the value is injected once at `createCNS`/`new CNS`. */
    withGlobal: <T>() => TNeuronFactory<TContextValue, TExt & { global: T }>;
    neuron: <TProvidedAxon extends Record<string, ICNSCollateral<unknown>>>(
        axon: TProvidedAxon
    ) => InterNeuronAPI<TContextValue, TCNSAxon<TProvidedAxon>, TExt>;
};

export const neuronFactory = <
    TContextValue = undefined,
    TExt = unknown
>(): TNeuronFactory<TContextValue, TExt> => {
    // Single stateless object reused across every layer call: `.withX()` only
    // re-types it, so there is nothing to allocate or carry at runtime.
    const factory: TNeuronFactory<TContextValue, TExt> = {
        withCtx: () => factory as unknown as TNeuronFactory<any, TExt>,
        withGlobal: () =>
            factory as unknown as TNeuronFactory<TContextValue, any>,
        neuron: axon => neuron(axon) as any,
    };
    return factory;
};

/** Sugar: `neuronFactory().withCtx<T>()`. Still exposes `.neuron`, so existing usage is unchanged. */
export const withCtx = <TContextValue>(): TNeuronFactory<TContextValue> =>
    neuronFactory<TContextValue>();

/** Sugar: `neuronFactory().withGlobal<T>()`. */
export const withGlobal = <T>(): TNeuronFactory<undefined, { global: T }> =>
    neuronFactory<undefined, { global: T }>();

export const afferentPath = (
    parentAfferentPath?: TCNSAfferentPath
): TCNSAfferentPath => {
    return {
        ...(parentAfferentPath !== undefined && {
            parentAfferentPath,
        }),
    };
};

export const modality = (
    afferentPaths: Record<string | number, TCNSAfferentPath>
): TCNSModality => {
    return {
        afferentPaths,
    };
};
