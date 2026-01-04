import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from '../types/TCNSAxon';
import { TCNSDendrite } from '../types/TCNSDendrite';
import { TCNSLocalContextValueStore } from '../types/TCNSLocalContextValueStore';
import { TNCNeuronResponseReturn } from '../types/TCNSNeuronResponseReturn';
import { ICNS } from '../interfaces/ICNS';
import { TCNSModality } from '../types/TCNSModality';
import { TCNSAfferentPath } from '../types/TCNSAfferentPath';
import { TCNSStimulationOptions } from '../types/TCNSStimulationOptions';
import { TCNSSignal } from '../types/TCNSSignal';

export const collateral = <TPayload = undefined, TName extends string = string>(
    name: TName
) => new CNSCollateral<TName, TPayload>(name);

// Helper types to extract collateral Name/Payload for a given key from a heterogenous axon-like object
type PayloadOf<TAxon, K extends keyof TAxon> = TAxon[K] extends CNSCollateral<
    any,
    infer P
>
    ? P
    : never;
type NameOf<TAxon, K extends keyof TAxon> = TAxon[K] extends CNSCollateral<
    infer N,
    any
>
    ? N
    : never;

// Helper type to extract payload union from an array of collaterals
// Uses distributive conditional type to properly extract union, not intersection
// Works with both arrays and tuples
type CollateralPayloadUnion<
    TCollaterals extends readonly CNSCollateral<any, any>[]
> = {
    [K in keyof TCollaterals]: TCollaterals[K] extends CNSCollateral<
        any,
        infer P
    >
        ? P
        : never;
}[number];

type InterNeuronAPI<
    TContextValue,
    TNameType extends string,
    TReceiverCollateralName extends string,
    TReceiverAxonCollateralPayload,
    TAxonType extends TCNSAxon<
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload
    >
> = {
    name: TNameType;
    axon: TAxonType;
    concurrency?: number;
    maxDuration?: number;
    dendrites: TCNSDendrite<
        TContextValue,
        string,
        unknown,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TAxonType
    >[];
    setConcurrency: (
        n: number | undefined
    ) => InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
    setMaxDuration: (
        ms: number | undefined
    ) => InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
    bind: <TFollowAxon extends Record<string, CNSCollateral<any, any>>>(
        axon: TFollowAxon,
        dendrites: {
            [K in keyof TFollowAxon]:
                | TCNSDendrite<
                      TContextValue,
                      NameOf<TFollowAxon, K> & string,
                      PayloadOf<TFollowAxon, K>,
                      TReceiverCollateralName,
                      TReceiverAxonCollateralPayload,
                      TAxonType
                  >
                | TCNSDendrite<
                      TContextValue,
                      NameOf<TFollowAxon, K> & string,
                      PayloadOf<TFollowAxon, K>,
                      TReceiverCollateralName,
                      TReceiverAxonCollateralPayload,
                      TAxonType
                  >['response'];
        }
    ) => InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
    dendrite: {
        // Overload for single collateral - type inferred from collateral value
        <TSenderCollateral extends CNSCollateral<string, any>>(s: {
            collateral: TSenderCollateral;
            response: (
                payload: TSenderCollateral extends CNSCollateral<any, infer P>
                    ? P
                    : never,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                }
            ) => TNCNeuronResponseReturn<
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload
            >;
        }): InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TAxonType
        >;
        // Overload for TCNSDendrite type
        <
            TSenderExactCollateralName extends string,
            TSenderExactAxonCollateralPayload
        >(
            s: TCNSDendrite<
                TContextValue,
                TSenderExactCollateralName,
                TSenderExactAxonCollateralPayload,
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload,
                TAxonType
            >
        ): InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TAxonType
        >;
        // Overload for array/tuple of collaterals with automatic union inference
        // Using variadic tuple types to automatically preserve individual collateral types
        // This overload works with tuple literals (automatically inferred)
        <
            TCollaterals extends readonly [
                CNSCollateral<string, any>,
                ...CNSCollateral<string, any>[]
            ]
        >(s: {
            collateral: TCollaterals;
            response: (
                payload: CollateralPayloadUnion<TCollaterals>,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                }
            ) => TNCNeuronResponseReturn<
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload
            >;
        }): InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TAxonType
        >;
        // Overload for regular arrays (fallback)
        <TCollaterals extends readonly CNSCollateral<string, any>[]>(s: {
            collateral: TCollaterals;
            response: (
                payload: CollateralPayloadUnion<TCollaterals>,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                }
            ) => TNCNeuronResponseReturn<
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload
            >;
        }): InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TAxonType
        >;
        // Overload for explicit union type (Type1 | Type2 | Type3) - more explicit and flexible
        <TPayloadUnion>(s: {
            collateral: CNSCollateral<string, any>[];
            response: (
                payload: TPayloadUnion,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                }
            ) => TNCNeuronResponseReturn<
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload
            >;
        }): InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TAxonType
        >;
    };
    modalityDendrite: {
        // Overload for single modality
        <
            TSenderCollateral extends CNSCollateral<string, any>,
            TModalityName extends string,
            TAfferentPathName extends string,
            TParentAfferentPathName extends string,
            TResult,
            TSenderPayload = TSenderCollateral extends CNSCollateral<
                any,
                infer P
            >
                ? P
                : never
        >(s: {
            collateral: TSenderCollateral;
            modality: TCNSModality<
                TModalityName,
                TAfferentPathName,
                TParentAfferentPathName
            >;
            afferentPaths?: {
                [P in TAfferentPathName]?: (
                    payload: TSenderPayload,
                    axon: TAxonType,
                    ctx: TCNSLocalContextValueStore<TContextValue> & {
                        abortSignal?: AbortSignal;
                        cns?: ICNS<any, any, any>;
                        stimulationId?: string;
                        stimulation?: any;
                    }
                ) => TResult | Promise<TResult>;
            };
            default?: (
                payload: TSenderPayload,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                    stimulation?: any;
                }
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                    stimulation?: any;
                }
            ) => TNCNeuronResponseReturn<
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload
            >;
        }): InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TAxonType
        >;
        // Overload for multiple modalities
        <
            TSenderCollateral extends CNSCollateral<string, any>,
            TResult,
            TSenderPayload = TSenderCollateral extends CNSCollateral<
                any,
                infer P
            >
                ? P
                : never
        >(s: {
            collateral: TSenderCollateral;
            modalities: Array<{
                modality: TCNSModality<string, string, string>;
                afferentPaths?: {
                    [key: string]: (
                        payload: TSenderPayload,
                        axon: TAxonType,
                        ctx: TCNSLocalContextValueStore<TContextValue> & {
                            abortSignal?: AbortSignal;
                            cns?: ICNS<any, any, any>;
                            stimulationId?: string;
                            stimulation?: any;
                        }
                    ) => TResult | Promise<TResult>;
                };
                default?: (
                    payload: TSenderPayload,
                    axon: TAxonType,
                    ctx: TCNSLocalContextValueStore<TContextValue> & {
                        abortSignal?: AbortSignal;
                        cns?: ICNS<any, any, any>;
                        stimulationId?: string;
                        stimulation?: any;
                    }
                ) => TResult | Promise<TResult>;
            }>;
            default?: (
                payload: TSenderPayload,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                    stimulation?: any;
                }
            ) => TResult | Promise<TResult>;
            output: (
                result: TResult,
                axon: TAxonType,
                ctx: TCNSLocalContextValueStore<TContextValue> & {
                    abortSignal?: AbortSignal;
                    cns?: ICNS<any, any, any>;
                    stimulationId?: string;
                    stimulation?: any;
                }
            ) => TNCNeuronResponseReturn<
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload
            >;
        }): InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TAxonType
        >;
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
    TNameType extends string,
    TProvidedAxon extends Record<string, CNSCollateral<any, any>>,
    TReceiverCollateralName extends keyof TProvidedAxon &
        string = keyof TProvidedAxon & string,
    TReceiverAxonCollateralPayload = TProvidedAxon[keyof TProvidedAxon] extends CNSCollateral<
        any,
        infer P
    >
        ? P
        : never
>(
    name: TNameType,
    axon: TProvidedAxon
): InterNeuronAPI<
    TContextValue,
    TNameType,
    TReceiverCollateralName,
    TReceiverAxonCollateralPayload,
    TCNSAxon<
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TProvidedAxon
    >
> => {
    const dendrites: TCNSDendrite<
        TContextValue,
        string,
        unknown,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TCNSAxon<
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TProvidedAxon
        >
    >[] = [];

    const api: InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TCNSAxon<
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TProvidedAxon
        >
    > = {
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
                        string,
                        unknown,
                        any,
                        any,
                        any
                    >
                );
            }
            return api;
        }) as InterNeuronAPI<
            TContextValue,
            TNameType,
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TCNSAxon<
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload,
                TProvidedAxon
            >
        >['bind'],
        axon: axon as unknown as TCNSAxon<
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload,
            TProvidedAxon
        >,
        name,
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
                    } as TCNSDendrite<TContextValue, string, unknown, TReceiverCollateralName, TReceiverAxonCollateralPayload, TCNSAxon<TReceiverCollateralName, TReceiverAxonCollateralPayload, TProvidedAxon>>);
                }
            } else {
                // Either full dendrite object or shorthand with single collateral
                // Both have the same structure, so we handle them the same way
                dendrites.push(
                    s as TCNSDendrite<
                        TContextValue,
                        string,
                        unknown,
                        TReceiverCollateralName,
                        TReceiverAxonCollateralPayload,
                        TCNSAxon<
                            TReceiverCollateralName,
                            TReceiverAxonCollateralPayload,
                            TProvidedAxon
                        >
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
                modality: TCNSModality<string, string, string>;
                afferentPaths?: Record<string, any>;
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
                          options?: TCNSStimulationOptions<
                              string,
                              unknown,
                              unknown,
                              string,
                              string,
                              string
                          >;
                      }
                    | undefined;

                const stimOptions = stimulation?.options;

                const runGlobalDefault = () => {
                    if (!globalDefaultHandler) {
                        const modalityName =
                            stimOptions?.modality?.name || 'unknown';
                        throw new Error(
                            `modalityDendrite: No handler found for modality "${modalityName}" and no default handler provided`
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

                // Find matching modality config
                const matchingConfig = modalityConfigs.find(
                    config =>
                        config.modality.name === stimOptions.modality?.name
                );

                if (!matchingConfig) {
                    return runGlobalDefault();
                }

                const pathName = stimOptions.afferentPath?.name as
                    | string
                    | undefined;

                const handler = pathName
                    ? matchingConfig.afferentPaths?.[pathName]
                    : undefined;

                const effectiveHandler =
                    handler ?? matchingConfig.default ?? globalDefaultHandler;

                if (!effectiveHandler) {
                    throw new Error(
                        `modalityDendrite: No handler found for afferent path "${pathName}" in modality "${matchingConfig.modality.name}" and no default handler provided`
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
            } as TCNSDendrite<TContextValue, string, unknown, TReceiverCollateralName, TReceiverAxonCollateralPayload, TCNSAxon<TReceiverCollateralName, TReceiverAxonCollateralPayload, TProvidedAxon>>);

            return api;
        },
    };

    return api;
};

export const withCtx = <TContextValue>() => ({
    neuron: <
        TNameType extends string,
        TProvidedAxon extends Record<string, CNSCollateral<any, any>>
    >(
        name: TNameType,
        axon: TProvidedAxon
    ) => {
        return neuron<TContextValue, TNameType, TProvidedAxon>(name, axon);
    },
});

// Helper type to extract all possible parent afferent path names from afferent paths
type ExtractParentAfferentPathNames<
    TAfferentPaths extends Record<string, TCNSAfferentPath<string, string>>
> = {
    [K in keyof TAfferentPaths]: TAfferentPaths[K]['parentAfferentPathName'];
}[keyof TAfferentPaths] &
    (keyof TAfferentPaths & string);

export const afferentPath = <
    TName extends string,
    TParentAfferentPathName extends string = string
>(
    name: TName,
    parentAfferentPathName?: TParentAfferentPathName
): TCNSAfferentPath<TName, TParentAfferentPathName> => {
    return {
        name,
        ...(parentAfferentPathName !== undefined && {
            parentAfferentPathName,
        }),
    };
};

export const modality = <
    TName extends string,
    TAfferentPaths extends Record<string, TCNSAfferentPath<string, string>>
>(
    name: TName,
    afferentPaths: TAfferentPaths
): TCNSModality<
    TName,
    keyof TAfferentPaths & string,
    ExtractParentAfferentPathNames<TAfferentPaths>
> => {
    return {
        name,
        afferentPaths: afferentPaths as unknown as TCNSModality<
            TName,
            keyof TAfferentPaths & string,
            ExtractParentAfferentPathNames<TAfferentPaths>
        >['afferentPaths'],
    };
};
