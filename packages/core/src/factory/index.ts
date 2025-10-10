import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from '../types/TCNSAxon';
import { TCNSDendrite } from '../types/TCNSDendrite';

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
    dendrite: <
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
    ) => InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
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
    TCNSAxon<TReceiverCollateralName, TReceiverAxonCollateralPayload>
> => {
    const dendrites: TCNSDendrite<
        TContextValue,
        string,
        unknown,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TCNSAxon<TReceiverCollateralName, TReceiverAxonCollateralPayload>
    >[] = [];

    const api: InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralName,
        TReceiverAxonCollateralPayload,
        TCNSAxon<TReceiverCollateralName, TReceiverAxonCollateralPayload>
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
            TCNSAxon<TReceiverCollateralName, TReceiverAxonCollateralPayload>
        >['bind'],
        axon: axon as unknown as TCNSAxon<
            TReceiverCollateralName,
            TReceiverAxonCollateralPayload
        >,
        name,
        concurrency: undefined,
        maxDuration: undefined,
        dendrites,
        dendrite<
            TSenderExactCollateralName extends string,
            TSenderExactAxonCollateralPayload
        >(
            s: TCNSDendrite<
                TContextValue,
                TSenderExactCollateralName,
                TSenderExactAxonCollateralPayload,
                TReceiverCollateralName,
                TReceiverAxonCollateralPayload,
                TCNSAxon<
                    TReceiverCollateralName,
                    TReceiverAxonCollateralPayload
                >
            >
        ) {
            dendrites.push(
                s as TCNSDendrite<
                    TContextValue,
                    string,
                    unknown,
                    TReceiverCollateralName,
                    TReceiverAxonCollateralPayload,
                    TCNSAxon<
                        TReceiverCollateralName,
                        TReceiverAxonCollateralPayload
                    >
                >
            );
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
