import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from '../types/TCNSAxon';
import { TCNSDendrite } from '../types/TCNSDendrite';
import { TCNSLocalContextValueStore } from '../types/TCNSLocalContextValueStore';
import { TNCNeuronResponseReturn } from '../types/TCNSNeuronResponseReturn';
import { ICNS } from '../interfaces/ICNS';
import { TCNSModality } from '../types/TCNSModality';
import { TCNSAfferentPath } from '../types/TCNSAfferentPath';
import { TCNSStimulationOptions } from '../types/TCNSStimulationOptions';

export const collateral = <TPayload = undefined>() =>
    new CNSCollateral<TPayload>();

// Helper type to extract payload union from an array of collaterals
// Uses distributive conditional type to properly extract union, not intersection
// Works with both arrays and tuples
type CollateralPayloadUnion<
    TCollaterals extends readonly CNSCollateral<unknown>[]
> = {
    [K in keyof TCollaterals]: TCollaterals[K] extends CNSCollateral<infer P>
        ? P
        : never;
}[number];

type InterNeuronAPI<TContextValue, TAxonType extends TCNSAxon = TCNSAxon> = {
    axon: TAxonType;
    concurrency?: number;
    maxDuration?: number;
    dendrites: TCNSDendrite<TContextValue, CNSCollateral<unknown>, TAxonType>[];
    setConcurrency: (
        n: number | undefined
    ) => InterNeuronAPI<TContextValue, TAxonType>;
    setMaxDuration: (
        ms: number | undefined
    ) => InterNeuronAPI<TContextValue, TAxonType>;
    bind: <TFollowAxon extends Record<string, CNSCollateral<unknown>>>(
        axon: TFollowAxon,
        dendrites: {
            [K in keyof TFollowAxon]:
                | TCNSDendrite<TContextValue, TFollowAxon[K], TAxonType>
                | TCNSDendrite<
                      TContextValue,
                      TFollowAxon[K],
                      TAxonType
                  >['response'];
        }
    ) => InterNeuronAPI<TContextValue, TAxonType>;
    dendrite: {
        <TSenderCollateral extends CNSCollateral<unknown>>(s: {
            collateral: TSenderCollateral;
            response: (
                payload: TSenderCollateral extends CNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any>;
                    stimulation?: any;
                }
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType>;
        <
            TCollaterals extends readonly [
                CNSCollateral<unknown>,
                ...CNSCollateral<unknown>[]
            ]
        >(s: {
            collateral: TCollaterals;
            response: (
                payload: CollateralPayloadUnion<TCollaterals>,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any>;
                    stimulation?: any;
                }
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType>;
        <TPayloadUnion>(s: {
            collateral: CNSCollateral<unknown>[];
            response: (
                payload: TPayloadUnion,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any>;
                    stimulation?: any;
                }
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType>;
        (
            s: TCNSDendrite<TContextValue, CNSCollateral<unknown>, TAxonType>
        ): InterNeuronAPI<TContextValue, TAxonType>;
    };
    modalityDendrite: {
        <TSenderCollateral extends CNSCollateral<unknown>, TResult>(s: {
            collateral: TSenderCollateral;
            modality: TCNSModality;
            afferentPaths?: Map<
                TCNSAfferentPath,
                (
                    payload: TSenderCollateral extends CNSCollateral<infer P>
                        ? P
                        : never,
                    axon: TAxonType,
                    ctx: TCNSLocalContextValueStore<TContextValue> & {
                        abortSignal?: AbortSignal;
                        cns?: ICNS<any, any>;
                        stimulation?: any;
                    }
                ) => TResult | Promise<TResult>
            >;
            default?: (
                payload: TSenderCollateral extends CNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any>;
                    stimulation?: any;
                }
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any>;
                    stimulation?: any;
                }
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType>;
        <TSenderCollateral extends CNSCollateral<unknown>, TResult>(s: {
            collateral: TSenderCollateral;
            modalities: Array<{
                modality: TCNSModality;
                afferentPaths?: Map<
                    TCNSAfferentPath,
                    (
                        payload: TSenderCollateral extends CNSCollateral<
                            infer P
                        >
                            ? P
                            : never,
                        axon: TAxonType,
                        ctx: TCNSLocalContextValueStore<TContextValue> & {
                            abortSignal?: AbortSignal;
                            cns?: ICNS<any, any>;
                            stimulation?: any;
                        }
                    ) => TResult | Promise<TResult>
                >;
                default?: (
                    payload: TSenderCollateral extends CNSCollateral<infer P>
                        ? P
                        : never,
                    axon: TAxonType,
                    ctx: TCNSLocalContextValueStore<TContextValue> & {
                        abortSignal?: AbortSignal;
                        cns?: ICNS<any, any>;
                        stimulation?: any;
                    }
                ) => TResult | Promise<TResult>;
            }>;
            default?: (
                payload: TSenderCollateral extends CNSCollateral<infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any>;
                    stimulation?: any;
                }
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any>;
                    stimulation?: any;
                }
            ) => TNCNeuronResponseReturn<TAxonType>;
        }): InterNeuronAPI<TContextValue, TAxonType>;
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
    TProvidedAxon extends Record<string, CNSCollateral<unknown>>
>(
    axon: TProvidedAxon
): InterNeuronAPI<TContextValue, TCNSAxon<TProvidedAxon>> => {
    const dendrites: TCNSDendrite<
        TContextValue,
        CNSCollateral<unknown>,
        TCNSAxon<TProvidedAxon>
    >[] = [];

    const api: InterNeuronAPI<TContextValue, TCNSAxon<TProvidedAxon>> = {
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
                        CNSCollateral<unknown>,
                        TCNSAxon<TProvidedAxon>
                    >
                );
            }
            return api;
        }) as InterNeuronAPI<TContextValue, TCNSAxon<TProvidedAxon>>['bind'],
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
                    } as TCNSDendrite<TContextValue, CNSCollateral<unknown>, TCNSAxon<TProvidedAxon>>);
                }
            } else {
                // Either full dendrite object or shorthand with single collateral
                // Both have the same structure, so we handle them the same way
                dendrites.push(
                    s as TCNSDendrite<
                        TContextValue,
                        CNSCollateral<unknown>,
                        TCNSAxon<TProvidedAxon>
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
                default: singleDefaultHandler,
                default: globalDefaultHandler,
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
                          default: singleDefaultHandler,
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
                    if (!globalDefaultHandler) {
                        throw new Error(
                            `modalityDendrite: No handler found for modality and no default handler provided`
                        );
                    }

                    const res = globalDefaultHandler(payload, axon, ctx);
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
                    handler ?? matchingConfig.default ?? globalDefaultHandler;

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
            } as TCNSDendrite<TContextValue, CNSCollateral<unknown>, TCNSAxon<TProvidedAxon>>);

            return api;
        },
    };

    return api;
};

export const withCtx = <TContextValue>() => ({
    neuron: <TProvidedAxon extends Record<string, CNSCollateral<unknown>>>(
        axon: TProvidedAxon
    ) => {
        return neuron<TContextValue, TProvidedAxon>(axon);
    },
});

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
