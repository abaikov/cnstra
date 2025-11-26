import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from '../types/TCNSAxon';
import { TCNSDendrite } from '../types/TCNSDendrite';
import { TCNSLocalContextValueStore } from '../types/TCNSLocalContextValueStore';
import { TNCNeuronResponseReturn } from '../types/TCNSNeuronResponseReturn';
import { ICNS } from '../interfaces/ICNS';

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
        // Overload for single collateral
        <
            TSenderExactCollateralName extends string,
            TSenderExactAxonCollateralPayload
        >(
            s:
                | TCNSDendrite<
                      TContextValue,
                      TSenderExactCollateralName,
                      TSenderExactAxonCollateralPayload,
                      TReceiverCollateralName,
                      TReceiverAxonCollateralPayload,
                      TAxonType
                  >
                | {
                      collateral: CNSCollateral<
                          TSenderExactCollateralName,
                          TSenderExactAxonCollateralPayload
                      >;
                      response: (
                          payload: TSenderExactAxonCollateralPayload,
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
                  }
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
};

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
