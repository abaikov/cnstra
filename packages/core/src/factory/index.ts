import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from '../types/TCNSAxon';
import { TCNSDendrite } from '../types/TCNSDendrite';

export const collateral = <TPayload = undefined, TType extends string = string>(
    type: TType
) => new CNSCollateral<TType, TPayload>(type);

type InterNeuronAPI<
    TContextValue,
    TNameType extends string,
    TReceiverCollateralType extends string,
    TReceiverAxonCollateralPayload,
    TAxonType extends TCNSAxon<
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload
    >
> = {
    name: TNameType;
    axon: TAxonType;
    concurrency?: number;
    dendrites: TCNSDendrite<
        TContextValue,
        string,
        unknown,
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >[];
    setConcurrency: (
        n: number | undefined
    ) => InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
    bind: <TFollowAxon extends TCNSAxon<string, any>>(
        axon: TFollowAxon,
        dendrites: {
            [K in keyof TFollowAxon]:
                | TCNSDendrite<
                      TContextValue,
                      K & string,
                      TFollowAxon extends TCNSAxon<any, infer P> ? P : never,
                      TReceiverCollateralType,
                      TReceiverAxonCollateralPayload,
                      TAxonType
                  >
                | TCNSDendrite<
                      TContextValue,
                      K & string,
                      TFollowAxon extends TCNSAxon<any, infer P> ? P : never,
                      TReceiverCollateralType,
                      TReceiverAxonCollateralPayload,
                      TAxonType
                  >['response'];
        }
    ) => InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
    dendrite: <
        TSenderExactCollateralType extends string,
        TSenderExactAxonCollateralPayload
    >(
        s: TCNSDendrite<
            TContextValue,
            TSenderExactCollateralType,
            TSenderExactAxonCollateralPayload,
            TReceiverCollateralType,
            TReceiverAxonCollateralPayload,
            TAxonType
        >
    ) => InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
};

// Concrete builder
export const neuron = <
    TContextValue,
    TNameType extends string,
    TReceiverCollateralType extends string,
    TReceiverAxonCollateralPayload,
    TAxonType extends TCNSAxon<
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload
    >
>(
    name: TNameType,
    axon: TAxonType
): InterNeuronAPI<
    TContextValue,
    TNameType,
    TReceiverCollateralType,
    TReceiverAxonCollateralPayload,
    TAxonType
> => {
    const dendrites: TCNSDendrite<
        TContextValue,
        string,
        unknown,
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >[] = [];

    const api: InterNeuronAPI<
        TContextValue,
        TNameType,
        TReceiverCollateralType,
        TReceiverAxonCollateralPayload,
        TAxonType
    > = {
        setConcurrency: (n: number | undefined) => {
            api.concurrency = n;
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
            TReceiverCollateralType,
            TReceiverAxonCollateralPayload,
            TAxonType
        >['bind'],
        axon,
        name,
        concurrency: undefined,
        dendrites,
        dendrite<
            TSenderExactCollateralType extends string,
            TSenderExactAxonCollateralPayload
        >(
            s: TCNSDendrite<
                TContextValue,
                TSenderExactCollateralType,
                TSenderExactAxonCollateralPayload,
                TReceiverCollateralType,
                TReceiverAxonCollateralPayload,
                TAxonType
            >
        ) {
            dendrites.push(
                s as TCNSDendrite<
                    TContextValue,
                    string,
                    unknown,
                    TReceiverCollateralType,
                    TReceiverAxonCollateralPayload,
                    TAxonType
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
        TReceiverCollateralType extends string,
        TReceiverAxonCollateralPayload,
        TAxonType extends TCNSAxon<
            TReceiverCollateralType,
            TReceiverAxonCollateralPayload
        >
    >(
        name: TNameType,
        axon: TAxonType
    ) => {
        return neuron<
            TContextValue,
            TNameType,
            TReceiverCollateralType,
            TReceiverAxonCollateralPayload,
            TAxonType
        >(name, axon);
    },
});

// Example usage to verify type inference
const fa = {
    test1: new CNSCollateral('test1'),
    test2: new CNSCollateral('test2'),
};

const fb = {
    test4: collateral<{ test44: string }, 'test4'>('test4'),
    test5: collateral<{ test44: string }, 'test5'>('test5'),
};

withCtx()
    .neuron('test', {
        test1: fa.test1,
        test2: fa.test2,
    })
    .bind(fb, {
        test4: (payload, axon) => {
            const ok: string = payload.test44;
            return axon.test1.createSignal(ok);
        },
        test5: (payload, axon) => {
            const ok2: string = payload.test44;
            return axon.test2.createSignal(ok2);
        },
    });
